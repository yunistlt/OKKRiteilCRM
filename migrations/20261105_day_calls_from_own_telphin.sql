-- Отчёты по звонкам переезжают с мёртвой выгрузки RetailCRM на свои звонки.
--
-- От RetailCRM отвязались 09.10.2026. Таблица `retailcrm_calls` не наполняется
-- с 09.10.2026 12:45, но по ней до сих пор считали:
--   * `sales_rop_call_day`      — срез по звонкам в вечернем отчёте бота-РОПа;
--   * `sales_rop_day_calls`     — список разговоров за день (разбор вечера,
--                                 инструмент `my_calls` у Семёна);
--   * `sales_rop_call_baseline` — средняя норма звонков за 14 дней;
--   * «Звонков сегодня» на экране «Мой день» (читало таблицу напрямую).
-- Пустой ответ мёртвой таблицы выглядит как «звонков не было»: у всех нули с
-- 09.10, и это никто не заметил месяц.
--
-- Что становится источником: `raw_telphin_calls` — наши звонки из Телфина, 450
-- разговоров в неделю, добавочный говорившего лежит колонкой
-- `manager_extension` и сходится с `managers.telphin_extension` у всех активных
-- менеджеров.
--
-- Три грабли, из-за которых всё это сложено в ОДНУ функцию, а не повторено в
-- каждом потребителе:
--
--  1. Ноги разговора. Очередь 200 звонит нескольким сразу, и каждая попытка
--     пишется своей строкой: 03.11 на один разговор с 9696250001 пришлось 12
--     строк. Без схлопывания активность отдела выглядит втрое выше, чем была.
--     Схлопываем по телефону клиента и окну в 2 минуты — то же правило, что
--     было в `sales_rop_day_calls`.
--  2. Кто говорил ≠ чей заказ. Победителем связки берём ногу, на которой
--     РАЗГОВАРИВАЛ менеджер. Если брать просто самую длинную, разговор уезжает
--     на добавочный 000 (секретарь/очередь, не менеджер) — за 7 дней таких ног
--     16, и столько же разговоров исчезло бы из отчётов живых людей.
--  3. Внутренние дозвоны. У Телфина исходящий «с добавочного на добавочный»
--     приходит без номера клиента (from = to = «12037*120», длительность 0).
--     Это артефакт набора, а не звонок: в счёт не берём.
--
-- Признак «дозвонились» не списываем заново: он уже вынесен в
-- `public.call_answered(jsonb, text)` (миграция 20261105_client_touch_sees_own_calls),
-- и третьей копии здесь нет.

-- ---------------------------------------------------------------------------
-- 1. Добавочный → менеджер. Одно место на все отчёты.
--
-- Один добавочный у двух менеджеров бывает: 108 стоит и у Теренкова Андрея
-- (id 102), и у технической карточки «Системный Администратор» (id 999).
-- Без DISTINCT ON такой звонок считался бы дважды, поэтому берём живого
-- человека: сначала активных, потом тех, кто работает в нашей CRM, и только
-- потом по id — чтобы результат не плавал между прогонами.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.manager_by_extension AS
    SELECT DISTINCT ON (m.telphin_extension)
           m.telphin_extension AS extension,
           m.id AS manager_id,
           nullif(trim(concat_ws(' ', m.last_name, m.first_name)), '') AS manager_name
      FROM public.managers m
     WHERE m.telphin_extension IS NOT NULL
       AND trim(m.telphin_extension) <> ''
     ORDER BY m.telphin_extension,
              (m.active IS TRUE) DESC,
              (m.own_crm IS TRUE) DESC,
              m.id;

COMMENT ON VIEW public.manager_by_extension IS
    'Добавочный Телфина → менеджер, по одной строке на добавочный. Один добавочный на двух карточках (108 у Теренкова и у системной) разрешается в пользу живого активного человека.';

-- ---------------------------------------------------------------------------
-- 2. Разговоры за период: ноги схлопнуты, менеджер разрешён.
--
-- Это единственное место, где решается, что считать разговором и кому он
-- принадлежит. Транскрипт и заказ сюда НЕ входят: по этой функции считают
-- средние за 14 дней, и тащить туда расшифровки незачем.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.own_calls_for_period(
    p_from timestamp with time zone,
    p_to timestamp with time zone
)
RETURNS TABLE(
    telphin_call_id text,
    started_at timestamp with time zone,
    direction text,
    duration_sec integer,
    client_phone text,
    manager_id bigint,
    manager_extension text,
    manager_name text,
    answered boolean,
    has_recording boolean
)
LANGUAGE sql
STABLE
AS $function$
    WITH nogi AS (
        SELECT t.telphin_call_id,
               t.started_at,
               t.direction,
               coalesce(t.duration_sec, 0) AS duration_sec,
               -- Номер собеседника: у входящего звонит он, у исходящего звоним мы.
               CASE WHEN t.direction = 'incoming' THEN t.from_number_normalized
                    ELSE t.to_number_normalized END AS client_phone,
               trim(t.manager_extension) AS extension,
               public.call_answered(t.raw_payload, t.recording_url) AS answered,
               (t.recording_url IS NOT NULL) AS has_recording
          FROM public.raw_telphin_calls t
         WHERE t.started_at >= p_from
           AND t.started_at < p_to
           -- Внутренний дозвон без номера клиента — не звонок (грабля 3).
           AND coalesce(CASE WHEN t.direction = 'incoming' THEN t.from_number_normalized
                             ELSE t.to_number_normalized END, '') <> ''
    ),
    -- Связка ног: тот же телефон, разница во времени меньше двух минут.
    -- Группу зовём по первой ноге связки — так же, как считала прежняя функция.
    svyazki AS (
        SELECT n.*,
               (SELECT min(x.started_at) FROM nogi x
                 WHERE x.client_phone = n.client_phone
                   AND abs(extract(epoch FROM (x.started_at - n.started_at))) <= 120) AS leg_group
          FROM nogi n
    ),
    pobediteli AS (
        SELECT DISTINCT ON (s.client_phone, s.leg_group) s.*, e.manager_id, e.manager_name
          FROM svyazki s
          LEFT JOIN public.manager_by_extension e ON e.extension = s.extension
         ORDER BY s.client_phone, s.leg_group,
                  -- Разговор принадлежит тому, кто на нём говорил (грабля 2).
                  (e.manager_id IS NOT NULL AND s.answered) DESC,
                  s.duration_sec DESC,
                  s.telphin_call_id
    )
    SELECT p.telphin_call_id, p.started_at, p.direction, p.duration_sec, p.client_phone,
           p.manager_id, p.extension, p.manager_name, p.answered, p.has_recording
      FROM pobediteli p;
$function$;

COMMENT ON FUNCTION public.own_calls_for_period(timestamp with time zone, timestamp with time zone) IS
    'Разговоры за период из наших звонков Телфина: ноги схлопнуты по телефону и окну 2 минуты, менеджер взят с ноги, на которой он говорил. Единственный источник для отчётов по звонкам после отвязки от RetailCRM 09.10.2026.';

-- ---------------------------------------------------------------------------
-- 3. Номер заказа к звонку.
--
-- Два уровня, и оба названы вслух — число в отчёте должно раскладываться до
-- источника:
--   * 'privyazka' — привязка звонка к заказу (`call_order_links_for_period`:
--     карточка заказа, ручная привязка, автопривязка, старое из RetailCRM);
--   * 'telefon'   — привязки нет, но номер разговора совпал с телефоном заказа
--     по хвосту из семи цифр. Автопривязка по закону владельца 05.10.2026
--     срабатывает только когда у клиента РОВНО ОДИН открытый заказ, поэтому
--     привязка есть лишь у 63 разговоров из 167 за 03–05.11, а по телефону
--     заказ находится у 137. Берём последний по времени правки заказ клиента и
--     помечаем, что это догадка по номеру, а не установленная привязка.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.own_call_orders(
    p_from timestamp with time zone,
    p_to timestamp with time zone
)
RETURNS TABLE(
    telphin_call_id text,
    order_id bigint,
    order_number text,
    order_source text,
    order_manager_name text
)
LANGUAGE sql
STABLE
AS $function$
    -- Берём ВСЕ звонки окна, а не только победителей связки: номер заказа —
    -- свойство звонка, а не схлопнутого разговора. Разбор вечера отбирает
    -- разговоры своим правилом (по `raw_payload`), и привязывать номера только
    -- к победителям значило терять их у части разговоров.
    WITH razgovory AS (
        SELECT t.telphin_call_id,
               CASE WHEN t.direction = 'incoming' THEN t.from_number_normalized
                    ELSE t.to_number_normalized END AS client_phone
          FROM public.raw_telphin_calls t
         WHERE t.started_at >= p_from
           AND t.started_at < p_to
    ),
    privyazka AS (
        SELECT DISTINCT ON (upper(l.telphin_call_id))
               l.telphin_call_id, l.order_id
          FROM public.call_order_links_for_period(p_from, p_to) l
         WHERE l.order_id IS NOT NULL
         ORDER BY upper(l.telphin_call_id),
                  CASE l.source WHEN 'own' THEN 1 WHEN 'crm' THEN 2 ELSE 3 END,
                  -- Один звонок бывает привязан к нескольким заказам. При
                  -- равной надёжности берём меньший номер, чтобы в отчёте не
                  -- плавало между прогонами.
                  l.order_id
    ),
    -- Оба условия на хвост телефона написаны отдельными ветками и каждое со
    -- своим «<> ''»: индексы `idx_orders_phone_tail7` и
    -- `idx_orders_additional_phone_tail7` частичные, и без этого планировщик их
    -- не берёт — запрос уходил в полный проход по заказам и считался 36 секунд.
    po_telefonu AS (
        SELECT r.telphin_call_id, z.order_id
          FROM razgovory r
          CROSS JOIN LATERAL (
                SELECT u.order_id
                  FROM (
                        SELECT o.order_id, o.updated_at
                          FROM public.orders o
                         WHERE o.phone_tail7 = right(r.client_phone, 7)
                           AND o.phone_tail7 <> ''
                           AND o.crm_deleted_at IS NULL
                        UNION ALL
                        SELECT o.order_id, o.updated_at
                          FROM public.orders o
                         WHERE o.additional_phone_tail7 = right(r.client_phone, 7)
                           AND o.additional_phone_tail7 <> ''
                           AND o.crm_deleted_at IS NULL
                  ) u
                 ORDER BY u.updated_at DESC NULLS LAST
                 LIMIT 1
          ) z
         WHERE length(right(r.client_phone, 7)) = 7
           AND NOT EXISTS (SELECT 1 FROM privyazka p WHERE upper(p.telphin_call_id) = upper(r.telphin_call_id))
    ),
    vmeste AS (
        SELECT telphin_call_id, order_id, 'privyazka'::text AS order_source FROM privyazka
        UNION ALL
        SELECT telphin_call_id, order_id, 'telefon'::text FROM po_telefonu
    )
    SELECT v.telphin_call_id,
           v.order_id,
           o.number::text,
           v.order_source,
           nullif(trim(concat_ws(' ', m.last_name, m.first_name)), '')
      FROM vmeste v
      JOIN public.orders o ON o.order_id = v.order_id
      LEFT JOIN public.managers m ON m.id = o.manager_id;
$function$;

COMMENT ON FUNCTION public.own_call_orders(timestamp with time zone, timestamp with time zone) IS
    'Номер заказа к звонку: сначала установленная привязка (order_source = privyazka), потом догадка по телефону заказа (order_source = telefon). Источник всегда назван, чтобы число в отчёте раскладывалось.';

-- ---------------------------------------------------------------------------
-- 4. Прежние функции — те же подписи, свой источник.
-- ---------------------------------------------------------------------------

-- Срез по звонкам за день по менеджерам: шапка вечернего отчёта бота-РОПа и
-- «Звонков сегодня» на экране «Мой день». Ключ `manager_id` раньше был
-- `manager_rc_id` из выгрузки RetailCRM; идентификаторы менеджеров у нас те же,
-- поэтому потребители не меняются.
CREATE OR REPLACE FUNCTION public.sales_rop_call_day(p_date date)
RETURNS TABLE(
    manager_id text, manager_name text, calls_total bigint, talks bigint,
    outgoing bigint, incoming bigint, missed bigint, talk_minutes numeric,
    first_call timestamp with time zone, last_call timestamp with time zone
)
LANGUAGE sql
STABLE
AS $function$
    SELECT c.manager_id::text,
           max(c.manager_name)::text,
           count(*),
           -- Разговор — тот, где дозвонились (`call_answered`). Прежняя оценка
           -- «дольше 20 секунд» считала минуту автоответчика работой. Вечерний
           -- отчёт поверх этого считает разговоры по расшифровкам — это
           -- оценка на день, пока расшифровок ещё нет.
           count(*) FILTER (WHERE c.answered),
           count(*) FILTER (WHERE c.direction = 'outgoing'),
           count(*) FILTER (WHERE c.direction = 'incoming'),
           count(*) FILTER (WHERE NOT c.answered),
           round(sum(c.duration_sec) / 60.0, 0),
           min(c.started_at),
           max(c.started_at)
      FROM public.own_calls_for_period(p_date::timestamptz, (p_date + 1)::timestamptz) c
     WHERE c.manager_id IS NOT NULL
     GROUP BY c.manager_id;
$function$;

-- Средняя норма за последние дни: с чем сравнивают сегодняшний день.
CREATE OR REPLACE FUNCTION public.sales_rop_call_baseline(p_days integer DEFAULT 14)
RETURNS TABLE(manager_id text, avg_calls numeric, avg_talks numeric, avg_minutes numeric)
LANGUAGE sql
STABLE
AS $function$
    SELECT manager_id::text,
           round(avg(n), 1), round(avg(t), 1), round(avg(m), 0)
      FROM (
          SELECT c.manager_id,
                 (c.started_at AT TIME ZONE 'Europe/Moscow')::date AS d,
                 count(*) n,
                 count(*) FILTER (WHERE c.answered) t,
                 sum(c.duration_sec) / 60.0 m
            FROM public.own_calls_for_period(
                     (now() - make_interval(days => p_days))::timestamptz,
                     now()
                 ) c
           WHERE c.manager_id IS NOT NULL
             -- Выходные в среднее не берём: они занизят будний норматив.
             AND EXTRACT(ISODOW FROM c.started_at AT TIME ZONE 'Europe/Moscow') <= 5
           GROUP BY c.manager_id, d
      ) t
     GROUP BY manager_id;
$function$;

-- Список разговоров менеджера за день: разбор вечера, инструмент `my_calls`
-- у Семёна. `p_manager` — идентификатор менеджера строкой, как было.
--
-- Колонка `order_source` добавлена: номер заказа, найденный по телефону, —
-- догадка, и называть её установленной привязкой нельзя. Из-за новой колонки
-- функцию приходится пересоздавать: тип возврата через CREATE OR REPLACE не
-- меняется. Потребители читают колонки по имени, их это не задевает.
DROP FUNCTION IF EXISTS public.sales_rop_day_calls(date, text);

CREATE FUNCTION public.sales_rop_day_calls(p_date date, p_manager text)
RETURNS TABLE(
    call_at timestamp with time zone, direction text, duration_sec integer,
    phone text, order_number text, order_source text, order_manager_name text,
    answered boolean, transcript text
)
LANGUAGE sql
STABLE
AS $function$
    SELECT c.started_at,
           CASE c.direction WHEN 'outgoing' THEN 'исходящий' ELSE 'входящий' END,
           c.duration_sec,
           c.client_phone,
           z.order_number,
           z.order_source,
           z.order_manager_name,
           c.answered,
           left(t.transcript, 1500)
      FROM public.own_calls_for_period(p_date::timestamptz, (p_date + 1)::timestamptz) c
      LEFT JOIN public.own_call_orders(p_date::timestamptz, (p_date + 1)::timestamptz) z
             ON upper(z.telphin_call_id) = upper(c.telphin_call_id)
      LEFT JOIN public.raw_telphin_calls t ON t.telphin_call_id = c.telphin_call_id
     WHERE c.manager_id::text = p_manager
     ORDER BY c.started_at;
$function$;

GRANT EXECUTE ON FUNCTION public.own_calls_for_period(timestamp with time zone, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.own_call_orders(timestamp with time zone, timestamp with time zone) TO service_role;
GRANT SELECT ON public.manager_by_extension TO service_role;

COMMENT ON FUNCTION public.sales_rop_day_calls(date, text) IS
    'Разговоры менеджера за день из наших звонков Телфина: ноги схлопнуты, номер заказа с указанием источника (privyazka или telefon).';

-- ---------------------------------------------------------------------------
-- 5. Что происходило с клиентом: его разговоры.
--
-- Карточка клиента («Активность») читала `retailcrm_calls` по номерам заказов
-- клиента — с 09.10.2026 там пусто у всех, и экран показывал «Звонков нет»
-- живым клиентам.
--
-- Связать звонок с клиентом через привязку к заказу нельзя: автопривязка по
-- закону владельца 05.10.2026 срабатывает только когда у клиента РОВНО ОДИН
-- открытый заказ. Поэтому идём по телефону — так же, как считает снимок
-- отношений с клиентом (`sales_refresh_client_relations`).
--
-- Телефон сверяем по последним десяти цифрам, а НЕ по хвосту из семи: только
-- так работают индексы `idx_raw_telphin_calls_from_normalized` и
-- `..._to_normalized` (хвост из семи цифр — выражение, индекса на него нет).
-- Без индексов запрос уходит в полный проход по таблице звонков (238 МБ,
-- 12 секунд), а у базы слабый диск — такие проходы в рабочее время запрещены.
-- Разница в охвате проверена на 03–05.11.2026: по десяти цифрам находится 124
-- разговора, по хвосту из семи — 125.
--
-- Ноги разговора здесь НЕ схлопываются. Так карточка работала и раньше: в
-- выгрузке RetailCRM ноги тоже лежали отдельными звонками. Правило схлопывания
-- живёт в `own_calls_for_period` и позвать его сюда нельзя — там фильтр по
-- периоду, а здесь нужен фильтр по телефону за всё время.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.own_client_calls(p_customer_id text, p_limit integer DEFAULT 30)
RETURNS TABLE(
    started_at timestamp with time zone,
    direction text,
    duration_sec integer,
    manager_name text,
    order_number text,
    order_source text,
    answered boolean,
    has_recording boolean
)
LANGUAGE sql
STABLE
AS $function$
    -- Клиента ищем по колонке `customer`, а не по `raw_payload->'customer'`:
    -- на колонке есть индекс `idx_orders_customer_id`, а на выражении из
    -- raw_payload — нет, и запрос уходил в полный проход по 38 794 заказам.
    -- Значения сверены: расхождений между ними ноль.
    WITH telefony AS (
        SELECT DISTINCT right(regexp_replace(p, '[^0-9]', '', 'g'), 10) AS num
          FROM public.orders o
          CROSS JOIN LATERAL unnest(ARRAY[o.phone, o.raw_payload->>'additionalPhone']) AS p
         WHERE o.customer->>'id' = p_customer_id
           AND coalesce(p, '') <> ''
    ),
    nomera AS (
        SELECT num FROM telefony WHERE length(num) = 10
    ),
    -- Два отдельных прохода по индексам вместо одного с OR: с `IN (...) OR
    -- IN (...)` планировщик индексы не берёт и идёт по всей таблице звонков
    -- (238 МБ, 12 секунд на запрос). Через UNION ALL каждая ветка — свой
    -- индексный поиск, и один дубль на звонок «сам себе» снимает DISTINCT ON.
    nogi AS (
        SELECT t.telphin_call_id, t.started_at, t.direction, coalesce(t.duration_sec, 0) AS duration_sec,
               trim(t.manager_extension) AS extension,
               public.call_answered(t.raw_payload, t.recording_url) AS answered,
               (t.recording_url IS NOT NULL) AS has_recording
          FROM public.raw_telphin_calls t
          JOIN nomera n ON n.num = t.from_number_normalized
        UNION ALL
        SELECT t.telphin_call_id, t.started_at, t.direction, coalesce(t.duration_sec, 0) AS duration_sec,
               trim(t.manager_extension) AS extension,
               public.call_answered(t.raw_payload, t.recording_url) AS answered,
               (t.recording_url IS NOT NULL) AS has_recording
          FROM public.raw_telphin_calls t
          JOIN nomera n ON n.num = t.to_number_normalized
    ),
    zvonki AS (
        SELECT DISTINCT ON (nogi.telphin_call_id) nogi.*
          FROM nogi
         ORDER BY nogi.telphin_call_id
    ),
    -- Один звонок бывает привязан к НЕСКОЛЬКИМ заказам (ограничение таблицы —
    -- пара «звонок + заказ»): у клиента 11550 один входящий 30.09 висит на
    -- девяти заказах, и без выбора одного из них карточка показывала один
    -- разговор девять раз. Берём ту же очерёдность, что и `call_order_link`.
    privyazka AS (
        SELECT DISTINCT ON (upper(m.telphin_call_id))
               upper(m.telphin_call_id) AS call_key,
               m.retailcrm_order_id AS order_id
          FROM public.call_order_matches m
         WHERE m.match_type <> 'ai_suggested'
           AND upper(m.telphin_call_id) IN (SELECT upper(z.telphin_call_id) FROM zvonki z)
         ORDER BY upper(m.telphin_call_id),
                  CASE m.match_type
                      WHEN 'okk_card' THEN 1
                      WHEN 'manual'   THEN 2
                      WHEN 'okk_auto' THEN 3
                      WHEN 'retailcrm' THEN 4
                      ELSE 9
                  END,
                  m.matched_at DESC
    )
    SELECT z.started_at,
           CASE z.direction WHEN 'outgoing' THEN 'исходящий' ELSE 'входящий' END,
           z.duration_sec,
           e.manager_name,
           o.number::text,
           CASE WHEN o.order_id IS NULL THEN NULL ELSE 'privyazka' END,
           z.answered,
           z.has_recording
      FROM zvonki z
      LEFT JOIN public.manager_by_extension e ON e.extension = z.extension
      -- Номер заказа только там, где привязка установлена: по телефону он здесь
      -- и так найден, называть его привязкой нельзя.
      LEFT JOIN privyazka p ON p.call_key = upper(z.telphin_call_id)
      LEFT JOIN public.orders o ON o.order_id = p.order_id
     ORDER BY z.started_at DESC
     LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.own_client_calls(text, integer) IS
    'Разговоры клиента из наших звонков Телфина: клиент найден по телефонам его заказов (последние десять цифр, под индекс). Заменила чтение мёртвой retailcrm_calls в карточке клиента.';

GRANT EXECUTE ON FUNCTION public.own_client_calls(text, integer) TO service_role;
