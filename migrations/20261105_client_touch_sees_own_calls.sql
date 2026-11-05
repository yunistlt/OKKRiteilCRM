-- Развитие клиента: разговор считается разговором, покупка — покупкой.
--
-- Ирина Гордеева 03.11.2026 (доработка №77): «Звонок совершен 28.10 по номеру
-- 7-495963-27-22 и есть комментарий, что нет потребности в нашей продукции.
-- задача приходит каждый день, прошу убрать».
--
-- Задача по клиенту ООО "РАД" приходила каждое утро полгода, и это не упрямство
-- механизма, а две ошибки в снимке отношений:
--
--   1. Касания по клиенту брались из `retailcrm_calls`. От RetailCRM отвязались
--      09.10.2026, таблица больше не наполняется — последняя строка там от
--      09.10.2026 12:45. Разговор 28.10 система не видела вовсе, поэтому
--      last_touch_at стоял на 02.01.2026, next_contact_at — в прошлом, и клиент
--      попадал в кандидаты КАЖДЫЙ день. Строка «молчим 306 дн» была неправдой.
--
--      Привязкой звонка к заказу тут не помочь: автопривязка по закону
--      05.10.2026 работает, только когда у клиента РОВНО ОДИН ОТКРЫТЫЙ заказ, а
--      блок развития как раз про клиентов без открытых заявок — такой звонок не
--      привязывается никогда. Поэтому берём разговор по номеру: хвост из семи
--      цифр от телефона заказа, то же правило, что в поиске заказа по номеру
--      (доработка №75).
--
--   2. Сумма покупок считалась как GREATEST(наши продажи, счётчик RetailCRM).
--      Счётчик ритейла считает ВСЕ заказы, включая отменённые, поэтому у РАД с
--      единственным заказом в статусе «Отменили закупку/смета» выходило
--      «Покупал на 21 012 000 ₽». Так врали 5 647 карточек из 7 809 с этапом
--      «купил»: заказы у нас есть, покупок — ни одной. Счётчик ритейла остаётся
--      запасным ровно для того, для чего и был нужен, — для 11 карточек, где
--      наших заказов нет совсем.
--
-- Писать ничего не нужно: снимок пересчитывает ночной прогон в 05:00.

-- Дозвонились или нет — одно определение на систему. Оно уже было списано
-- дважды (представление `call_order_link` и `call_order_links_for_period`);
-- третья копия здесь была бы началом расхождения.
CREATE OR REPLACE FUNCTION public.call_answered(p_payload jsonb, p_recording text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT p_recording IS NOT NULL
        OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(coalesce(p_payload->'cdr', '[]'::jsonb)) c
             WHERE coalesce((c.value->>'duration')::integer, 0) > 0
        );
$function$;

CREATE OR REPLACE VIEW public.call_order_link AS
    SELECT z.telphin_call_id,
           m.retailcrm_order_id::bigint AS order_id,
           z.started_at,
           z.duration_sec,
           z.direction,
           nullif(z.raw_payload->>'manager_id', '')::bigint AS manager_id,
           CASE
               WHEN m.match_type = ANY (ARRAY['okk_card', 'manual', 'okk_auto']) THEN 'own'
               WHEN m.match_type = 'retailcrm' THEN 'crm'
               ELSE 'match'
           END AS source,
           m.match_type,
           m.explanation,
           public.call_answered(z.raw_payload, z.recording_url) AS answered
      FROM public.call_order_matches m
      CROSS JOIN LATERAL (
            SELECT t.telphin_call_id, t.started_at, t.duration_sec, t.direction,
                   t.raw_payload, t.recording_url
              FROM public.raw_telphin_calls t
             WHERE upper(t.telphin_call_id) = upper(m.telphin_call_id)
             ORDER BY coalesce(t.duration_sec, 0) DESC, (t.recording_url IS NOT NULL) DESC
             LIMIT 1
      ) z
     WHERE m.match_type <> 'ai_suggested'
       AND NOT EXISTS (
           SELECT 1
             FROM public.call_order_matches better
            WHERE upper(better.telphin_call_id) = upper(m.telphin_call_id)
              AND better.match_type <> 'ai_suggested'
              AND (ROW(
                      CASE better.match_type
                          WHEN 'okk_card' THEN 1
                          WHEN 'manual' THEN 2
                          WHEN 'okk_auto' THEN 3
                          WHEN 'retailcrm' THEN 4
                          ELSE 9
                      END,
                      (SELECT -EXTRACT(epoch FROM better.matched_at)),
                      better.match_id
                  ) < ROW(
                      CASE m.match_type
                          WHEN 'okk_card' THEN 1
                          WHEN 'manual' THEN 2
                          WHEN 'okk_auto' THEN 3
                          WHEN 'retailcrm' THEN 4
                          ELSE 9
                      END,
                      (SELECT -EXTRACT(epoch FROM m.matched_at)),
                      m.match_id
                  ))
       );

CREATE OR REPLACE FUNCTION public.call_order_links_for_period(
    p_from timestamp with time zone,
    p_to timestamp with time zone
)
RETURNS TABLE(
    telphin_call_id text, order_id bigint, started_at timestamp with time zone,
    duration_sec integer, direction text, manager_id bigint, source text,
    match_type text, answered boolean
)
LANGUAGE sql
STABLE
AS $function$
    WITH za_period AS (
        SELECT DISTINCT ON (upper(t.telphin_call_id))
               t.telphin_call_id,
               upper(t.telphin_call_id) AS call_key,
               t.started_at,
               t.duration_sec,
               t.direction,
               nullif(t.raw_payload->>'manager_id', '')::bigint AS manager_id,
               t.record_uuids,
               public.call_answered(t.raw_payload, t.recording_url) AS answered
          FROM public.raw_telphin_calls t
         WHERE t.started_at >= p_from
           AND t.started_at < p_to
         ORDER BY upper(t.telphin_call_id),
                  coalesce(t.duration_sec, 0) DESC,
                  (t.recording_url IS NOT NULL) DESC
    ),
    privyazka AS (
        SELECT DISTINCT ON (upper(m.telphin_call_id))
               upper(m.telphin_call_id) AS call_key,
               m.retailcrm_order_id AS order_id,
               m.match_type
          FROM public.call_order_matches m
         WHERE m.match_type <> 'ai_suggested'
           AND upper(m.telphin_call_id) IN (SELECT call_key FROM za_period)
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
    SELECT z.telphin_call_id, p.order_id, z.started_at, z.duration_sec, z.direction, z.manager_id,
           CASE
               WHEN p.match_type IN ('okk_card', 'manual', 'okk_auto') THEN 'own'
               WHEN p.match_type = 'retailcrm' THEN 'crm'
               ELSE 'match'
           END,
           p.match_type,
           z.answered
      FROM za_period z
      JOIN privyazka p ON p.call_key = z.call_key

    UNION ALL

    -- Звонки, привязанные к заказу в RetailCRM и не попавшие в наш матчинг.
    -- От RetailCRM отвязались, новых таких не появляется — ветка нужна только
    -- для дней до отвязки, которые ещё попадают в 35-дневное окно.
    SELECT z.telphin_call_id, o.order_id, z.started_at, z.duration_sec, z.direction,
           nullif(c.manager_rc_id, '')::bigint, 'crm', 'retailcrm', z.answered
      FROM za_period z
      JOIN public.retailcrm_calls c ON c.external_id = ANY (z.record_uuids)
      JOIN public.orders o ON o.number = c.order_number
     WHERE c.order_number IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.call_order_matches m
            WHERE upper(m.telphin_call_id) = z.call_key
              AND m.match_type <> 'ai_suggested'
       );
$function$;

CREATE OR REPLACE FUNCTION public.sales_refresh_client_relations()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
    v_kupil int;
    v_schitali int;
    v_obratilsia int;
    v_deal_statuses text[];
    v_count int;
BEGIN
    SELECT coalesce(max(value::int), 90) INTO v_kupil FROM public.sales_rop_settings WHERE key = 'cadence_kupil';
    SELECT coalesce(max(value::int), 30) INTO v_schitali FROM public.sales_rop_settings WHERE key = 'cadence_schitali';
    SELECT coalesce(max(value::int), 60) INTO v_obratilsia FROM public.sales_rop_settings WHERE key = 'cadence_obratilsia';

    -- Что считается состоявшейся покупкой — один список на всю систему
    -- (им же считает зарплата). Настройка датированная, берём действующую.
    SELECT coalesce((
        WITH latest AS (
            SELECT sc.value
              FROM public.salary_config sc
             WHERE sc.key = 'deal_statuses'
               AND sc.effective_from <= now()
             ORDER BY sc.effective_from DESC
             LIMIT 1
        )
        SELECT array_agg(elem)
          FROM latest, LATERAL jsonb_array_elements_text(latest.value) AS elem
    ), ARRAY['send-assembling', 'otgruzen', 'complete', 'delivering', 'send-to-delivery', 'reklamac'])
    INTO v_deal_statuses;

    WITH base AS (
        -- Берём всех, отбор «кто реально обращался» — ниже, в per_card: там уже
        -- известно, есть ли у карточки наши заказы. Раньше отбор стоял здесь и
        -- выбрасывал свою карточку без ИНН, даже когда заказы у неё есть.
        SELECT c.id,
               nullif(trim(coalesce(c.inn, '')), '') AS inn,
               coalesce(nullif(trim(coalesce(c.company_name, '')), ''),
                        nullif(trim(concat_ws(' ', c.last_name, c.first_name)), ''),
                        'без названия') AS client_name,
               -- В карточке клиента идентификатор менеджера хранится строкой.
               nullif(regexp_replace(coalesce(c.manager_id::text, ''), '[^0-9]', '', 'g'), '')::bigint AS manager_id,
               coalesce(c.orders_count, 0) AS orders_count,
               coalesce(c.total_summ, 0) AS total_summ,
               c.last_order_at
          FROM public.clients c
    ),
    -- Один клиент — одна строка, даже если карточек в CRM несколько.
    keyed AS (
        SELECT coalesce(b.inn, 'cust:' || b.id::text) AS client_key, b.*
          FROM base b
    ),
    -- Заказы и звонки сворачиваем по владельцу карточки ОДИН раз на всю базу.
    -- Подзапрос на каждого клиента означал полный проход по заказам 13 тысяч
    -- раз и не укладывался в разумное время.
    order_agg AS (
        SELECT (o.raw_payload->'customer'->>'id') AS cust_id,
               max(o.updated_at) AS last_order_touch,
               bool_or(ss.is_working IS TRUE) AS has_open_deal,
               -- Сколько заказов этого клиента есть У НАС. Нужно, чтобы знать,
               -- можно ли верить нашему счёту покупок: см. staged ниже.
               count(*)::int AS our_orders,
               -- Последний заказ считаем здесь же: искать его при выдаче плана
               -- значит перебирать заказы на каждого клиента заново.
               (array_agg(o.order_id ORDER BY o.updated_at DESC))[1] AS last_order_id,
               (array_agg(o.number ORDER BY o.updated_at DESC))[1] AS last_order_number,
               -- Сумма ИМЕННО последнего заказа. Был максимум по всем заказам
               -- клиента, и спам-заявка на 0 ₽ показывалась чужой суммой.
               (array_agg(coalesce(o.totalsumm, 0) ORDER BY o.updated_at DESC))[1] AS last_order_amount,
               -- Состоявшиеся покупки: «Передано в производство» и дальше.
               count(*) FILTER (WHERE o.status = ANY (v_deal_statuses))::int AS deal_count,
               coalesce(sum(coalesce(o.totalsumm, 0)) FILTER (WHERE o.status = ANY (v_deal_statuses)), 0) AS deal_summ,
               -- Запасной владелец: кто вёл последний заказ. Нужен там, где в
               -- карточке клиента менеджер не проставлен — таких 1 659.
               (array_agg(o.manager_id ORDER BY o.updated_at DESC) FILTER (WHERE o.manager_id IS NOT NULL))[1] AS last_order_manager
          FROM public.orders o
          LEFT JOIN public.status_settings ss ON ss.code = o.status
         WHERE o.raw_payload->'customer'->>'id' IS NOT NULL
         GROUP BY 1
    ),
    -- Состоявшиеся разговоры: свои звонки Телфина по хвосту из семи цифр.
    -- Телефон клиента живёт в заказе (в карточке его часто нет вовсе), поэтому
    -- номер разговора сводим с телефонами заказов этого клиента.
    razgovor AS MATERIALIZED (
        SELECT right(CASE WHEN t.direction = 'incoming' THEN t.from_number_normalized
                          ELSE t.to_number_normalized END, 7) AS tail7,
               max(t.started_at) AS last_call
          FROM public.raw_telphin_calls t
         WHERE t.started_at >= now() - interval '400 days'
           AND length(right(CASE WHEN t.direction = 'incoming' THEN t.from_number_normalized
                                 ELSE t.to_number_normalized END, 7)) = 7
           AND public.call_answered(t.raw_payload, t.recording_url)
         GROUP BY 1
    ),
    call_agg AS (
        SELECT z.cust_id, max(r.last_call) AS last_call
          FROM (
            SELECT o.raw_payload->'customer'->>'id' AS cust_id, tail.tail7
              FROM public.orders o
              CROSS JOIN LATERAL unnest(ARRAY[o.phone_tail7, o.additional_phone_tail7]) AS tail(tail7)
             WHERE o.raw_payload->'customer'->>'id' IS NOT NULL
               AND coalesce(tail.tail7, '') <> ''
          ) z
          JOIN razgovor r ON r.tail7 = z.tail7
         GROUP BY 1
    ),
    per_card AS (
        SELECT k.*,
               GREATEST(k.last_order_at, oa.last_order_touch, ca.last_call) AS card_touch,
               coalesce(oa.has_open_deal, false) AS card_open_deal,
               oa.last_order_id,
               oa.last_order_number,
               oa.last_order_amount,
               oa.last_order_touch,
               coalesce(oa.our_orders, 0) AS our_orders,
               coalesce(oa.deal_count, 0) AS deal_count,
               coalesce(oa.deal_summ, 0) AS deal_summ,
               coalesce(k.manager_id, oa.last_order_manager) AS owner_id
          FROM keyed k
          LEFT JOIN order_agg oa ON oa.cust_id = k.id::text
          LEFT JOIN call_agg ca ON ca.cust_id = k.id::text
         -- Кто реально обращался: есть ИНН, есть заказы у нас или счётчик из
         -- ритейла. Остальное в базе — следы старых импортов, в плане это мусор.
         WHERE k.inn IS NOT NULL
            OR oa.cust_id IS NOT NULL
            OR k.orders_count > 0
    ),
    grouped AS (
        SELECT p.client_key,
               (array_agg(p.client_name ORDER BY p.total_summ DESC))[1] AS client_name,
               (array_agg(p.inn) FILTER (WHERE p.inn IS NOT NULL))[1] AS inn,
               (array_agg(p.owner_id ORDER BY p.last_order_at DESC NULLS LAST)
                    FILTER (WHERE p.owner_id IS NOT NULL))[1] AS manager_id,
               -- Покупки и выручка — по нашим заказам. Счётчик RetailCRM берём
               -- только там, где наших заказов нет вовсе: он считает все заказы
               -- подряд, включая отменённые, и выданный за покупки превращался
               -- в «Покупал на 21 012 000 ₽» у клиента, который не купил ничего.
               CASE WHEN sum(p.our_orders) > 0 THEN sum(p.deal_count)
                    ELSE sum(p.orders_count) END::int AS orders_count,
               CASE WHEN sum(p.our_orders) > 0 THEN sum(p.deal_summ)
                    ELSE sum(p.total_summ) END AS total_summ,
               max(p.card_touch) AS last_touch_at,
               bool_or(p.card_open_deal) AS has_open_deal,
               (array_agg(p.last_order_id ORDER BY p.last_order_touch DESC NULLS LAST))[1] AS last_order_id,
               (array_agg(p.last_order_number ORDER BY p.last_order_touch DESC NULLS LAST))[1] AS last_order_number,
               coalesce(max(p.last_order_amount), 0) AS last_order_amount
          FROM per_card p
         GROUP BY p.client_key
    ),
    staged AS (
        SELECT g.*,
               CASE
                   WHEN g.total_summ > 0 THEN 'kupil'
                   -- «Считали» — это когда сумма в заказе появилась: человеку
                   -- посчитали и назвали цену. Заявка, закрытая на нуле, —
                   -- обращение, до просчёта там не дошло. Треть заказов в базе
                   -- именно такие, и путать их нельзя: разговор разный.
                   WHEN g.last_order_amount > 0 THEN 'schitali'
                   ELSE 'obratilsia'
               END AS stage
          FROM grouped g
    )
    INSERT INTO public.sales_client_relation AS r
        (client_key, client_name, inn, manager_id, stage, orders_count, total_summ,
         last_touch_at, next_contact_at, has_open_deal, last_order_id, last_order_number,
         last_order_amount, updated_at)
    SELECT s.client_key, s.client_name, s.inn, s.manager_id, s.stage, s.orders_count, s.total_summ,
           s.last_touch_at,
           (coalesce(s.last_touch_at, now()) + make_interval(days => CASE s.stage
                WHEN 'kupil' THEN v_kupil
                WHEN 'schitali' THEN v_schitali
                ELSE v_obratilsia
           END))::date,
           s.has_open_deal,
           s.last_order_id,
           s.last_order_number::text,
           s.last_order_amount,
           now()
      FROM staged s
    ON CONFLICT (client_key) DO UPDATE SET
        client_name = EXCLUDED.client_name,
        inn = EXCLUDED.inn,
        manager_id = EXCLUDED.manager_id,
        stage = EXCLUDED.stage,
        orders_count = EXCLUDED.orders_count,
        total_summ = EXCLUDED.total_summ,
        last_touch_at = EXCLUDED.last_touch_at,
        -- Ритм не сдвигаем, пока касаний не было: дата, назначенная человеком,
        -- переживает пересчёт.
        next_contact_at = CASE
            WHEN r.last_touch_at IS DISTINCT FROM EXCLUDED.last_touch_at THEN EXCLUDED.next_contact_at
            ELSE r.next_contact_at
        END,
        has_open_deal = EXCLUDED.has_open_deal,
        last_order_id = EXCLUDED.last_order_id,
        last_order_number = EXCLUDED.last_order_number,
        last_order_amount = EXCLUDED.last_order_amount,
        updated_at = now();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.call_answered(jsonb, text) TO service_role;
