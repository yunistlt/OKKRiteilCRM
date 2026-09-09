-- Отношения с клиентом отдельно от сделок.
--
-- До сих пор «развитие клиента» строилось от покупок: в план попадал только
-- тот, кто уже что-то купил. Половина базы при этом невидима — 10 007 клиентов
-- из 20 502 не купили ничего. Среди них те, кто обращался и считался: их не
-- дёргает никто, потому что заказ закрыт, а покупки нет.
--
-- Заказ и клиент — разные сущности. Заказ говорит «счёт висит, позвони по
-- нему», и умирает вместе со сделкой. Отношение с клиентом живёт всегда:
-- Росатом, который обратился и не купил, должен попадать в план ровно так же,
-- как постоянный покупатель, — только с другим разговором.
--
-- Снимок пересчитывается ночью: утренний прогон должен читать готовое, а не
-- считать историю касаний по всей базе.
CREATE TABLE IF NOT EXISTS public.sales_client_relation (
    -- Ключ клиента: ИНН, иначе идентификатор карточки CRM. По телефону и почте
    -- склеивать нельзя — у посредников общие ящики на десяток компаний.
    client_key text PRIMARY KEY,
    client_name text,
    inn text,
    /** Кто ведёт: менеджер из карточки CRM, иначе — кто последний общался. */
    manager_id bigint,
    /**
     * Стадия отношений, не воронка сделки:
     *   kupil      — покупал хоть раз
     *   schitali   — обращался, считали, не купил
     *   obratilsia — обращался, до просчёта не дошло
     */
    stage text NOT NULL,
    orders_count int NOT NULL DEFAULT 0,
    total_summ numeric NOT NULL DEFAULT 0,
    /** Последнее касание любой природы: заказ, звонок. */
    last_touch_at timestamptz,
    /** Когда пора напомнить о себе. */
    next_contact_at date,
    /** Есть ли живая сделка: по ней и так напоминают, второй повод — спам. */
    has_open_deal boolean NOT NULL DEFAULT false,
    /** Последний заказ клиента — чтобы менеджеру было с чего начать разговор. */
    last_order_id bigint,
    last_order_number text,
    /**
     * Самый крупный просчёт клиента. Для того, кто не купил, это и есть мера
     * интереса: последний заказ может быть пустой заявкой на ноль, а полгода
     * назад ему считали цех на двадцать миллионов.
     */
    last_order_amount numeric NOT NULL DEFAULT 0,
    /** Стоп-лист: клиент попросил не звонить, конкурент, ошибка в базе. */
    muted boolean NOT NULL DEFAULT false,
    muted_reason text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_relation_next ON public.sales_client_relation (next_contact_at)
    WHERE NOT muted;
CREATE INDEX IF NOT EXISTS idx_client_relation_manager ON public.sales_client_relation (manager_id);

-- Ритм касаний по стадиям. В базе, а не в коде: сроки правит человек.
INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('cadence_kupil', '90', 'Через сколько дней напомнить о себе клиенту, который покупал'),
    ('cadence_schitali', '30', 'То же для тех, кому считали, но не купили'),
    ('cadence_obratilsia', '60', 'То же для тех, кто обращался, но до просчёта не дошло'),
    ('client_touch_per_day', '2', 'Сколько напоминаний о клиенте давать менеджеру в день')
ON CONFLICT (key) DO UPDATE SET comment = EXCLUDED.comment;

-- Пересчёт снимка. Зовётся ночью, перед утренним прогоном.
CREATE OR REPLACE FUNCTION public.sales_refresh_client_relations()
RETURNS int
LANGUAGE plpgsql AS $function$
DECLARE
    v_kupil int;
    v_schitali int;
    v_obratilsia int;
    v_count int;
BEGIN
    SELECT coalesce(max(value::int), 90) INTO v_kupil FROM public.sales_rop_settings WHERE key = 'cadence_kupil';
    SELECT coalesce(max(value::int), 30) INTO v_schitali FROM public.sales_rop_settings WHERE key = 'cadence_schitali';
    SELECT coalesce(max(value::int), 60) INTO v_obratilsia FROM public.sales_rop_settings WHERE key = 'cadence_obratilsia';

    WITH base AS (
        -- Берём тех, кто реально обращался: есть ИНН или есть заказы. Остальное
        -- в CRM — следы старых импортов, и в плане они выглядят как мусор.
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
         WHERE nullif(trim(coalesce(c.inn, '')), '') IS NOT NULL
            OR coalesce(c.orders_count, 0) > 0
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
               -- Последний заказ считаем здесь же: искать его при выдаче плана
               -- значит перебирать заказы на каждого клиента заново.
               (array_agg(o.order_id ORDER BY o.updated_at DESC))[1] AS last_order_id,
               (array_agg(o.number ORDER BY o.updated_at DESC))[1] AS last_order_number,
               max(coalesce(o.totalsumm, 0)) AS last_order_amount,
               -- Запасной владелец: кто вёл последний заказ. Нужен там, где в
               -- карточке клиента менеджер не проставлен — таких 1 659.
               (array_agg(o.manager_id ORDER BY o.updated_at DESC) FILTER (WHERE o.manager_id IS NOT NULL))[1] AS last_order_manager
          FROM public.orders o
          LEFT JOIN public.status_settings ss ON ss.code = o.status
         WHERE o.raw_payload->'customer'->>'id' IS NOT NULL
         GROUP BY 1
    ),
    call_agg AS (
        SELECT c.customer_rc_id AS cust_id, max(c.call_date) AS last_call
          FROM public.retailcrm_calls c
         WHERE c.customer_rc_id IS NOT NULL
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
               coalesce(k.manager_id, oa.last_order_manager) AS owner_id
          FROM keyed k
          LEFT JOIN order_agg oa ON oa.cust_id = k.id::text
          LEFT JOIN call_agg ca ON ca.cust_id = k.id::text
    ),
    grouped AS (
        SELECT p.client_key,
               (array_agg(p.client_name ORDER BY p.total_summ DESC))[1] AS client_name,
               (array_agg(p.inn) FILTER (WHERE p.inn IS NOT NULL))[1] AS inn,
               (array_agg(p.owner_id ORDER BY p.last_order_at DESC NULLS LAST)
                    FILTER (WHERE p.owner_id IS NOT NULL))[1] AS manager_id,
               sum(p.orders_count)::int AS orders_count,
               sum(p.total_summ) AS total_summ,
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

-- Кому пора напомнить о себе. Выдаётся утреннему плану.
-- Набор колонок менялся, поэтому пересоздаём. Оба стейтмента идут одной
-- транзакцией — момента без функции для прода не существует.
DROP FUNCTION IF EXISTS public.sales_client_touch_candidates(date);
DROP FUNCTION IF EXISTS public.sales_client_touch_candidates(date, int);

-- Кому пора напомнить о себе. Выдаётся утреннему плану.
--
-- Отбор делаем здесь, а не в коде: клиентов, которым пора, — одиннадцать тысяч,
-- а через API приезжает только первая тысяча строк. Первая тысяча по деньгам —
-- это сплошь крупные покупатели, и несостоявшиеся заказчики не попадали в план
-- вообще. Поэтому берём по нескольку лучших на каждого менеджера отдельно для
-- покупавших и отдельно для остальных.
CREATE FUNCTION public.sales_client_touch_candidates(p_today date, p_per_group int DEFAULT 5)
RETURNS TABLE (
    client_key text,
    client_name text,
    manager_id bigint,
    stage text,
    orders_count int,
    total_summ numeric,
    days_since int,
    last_order_id bigint,
    last_order_number text,
    last_order_amount numeric
)
LANGUAGE sql STABLE AS $function$
    WITH ranked AS (
        SELECT r.*,
               -- Вес отношения, а не только прошлые деньги: для того, кто не
               -- купил, вес — сумма его просчёта. Иначе крупный несостоявшийся
               -- заказчик навсегда проигрывает мелкому постоянному.
               GREATEST(r.total_summ, r.last_order_amount) AS weight,
               row_number() OVER (
                   PARTITION BY r.manager_id, (r.stage = 'kupil')
                   ORDER BY GREATEST(r.total_summ, r.last_order_amount) DESC, r.last_touch_at ASC NULLS LAST
               ) AS rn
          FROM public.sales_client_relation r
         WHERE NOT r.muted
           -- По живой сделке напоминают отдельно: два повода в один день
           -- читаются как спам, и человек перестаёт читать оба.
           AND NOT r.has_open_deal
           AND r.manager_id IS NOT NULL
           AND r.next_contact_at <= p_today
    )
    SELECT client_key, client_name, manager_id, stage, orders_count, total_summ,
           EXTRACT(DAY FROM now() - last_touch_at)::int,
           last_order_id, last_order_number, last_order_amount
      FROM ranked
     WHERE rn <= p_per_group
     ORDER BY weight DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_refresh_client_relations() TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_client_touch_candidates(date, int) TO service_role;
