-- Функции отчётов читают один справочник статусов — crm_statuses.
--
-- Четыре функции (план продавца, воронка, история заказа, досье клиента)
-- брали имя статуса из таблицы `statuses`. Она уходит: статусы ведём в
-- `crm_statuses`. Сопоставляем по обоим кодам — у заказов, созданных до
-- перехода, стоит старый код.

CREATE OR REPLACE FUNCTION public.sales_client_deep(p_client_key text)
 RETURNS TABLE(customer_ids bigint[], emails text[], phones text[], won_orders jsonb, lost_orders jsonb, comments jsonb, calls jsonb)
 LANGUAGE sql
 STABLE
AS $function$
    WITH mine AS (
        SELECT o.order_id, o.number, o.status, o.totalsumm, o.created_at, o.raw_payload,
               o.prichiny_otmeny
          FROM public.orders o
         WHERE coalesce(
                   nullif(o.raw_payload->'contragent'->>'INN', ''),
                   'cid:' || coalesce(o.raw_payload->'customer'->>'id', o.order_id::text)
               ) = p_client_key
    )
    SELECT
        (SELECT array_agg(DISTINCT (raw_payload->'customer'->>'id')::bigint)
           FROM mine WHERE raw_payload->'customer'->>'id' ~ '^\d+$'),

        -- Почта нужна не для писем, а чтобы узнать компанию по домену.
        (SELECT array_agg(DISTINCT e) FROM (
            SELECT jsonb_array_elements_text(
                       coalesce(raw_payload->'customer'->'contactEmails', '[]'::jsonb)
                   ) e FROM mine
            UNION
            SELECT raw_payload->>'email' FROM mine WHERE raw_payload->>'email' <> ''
        ) t WHERE e IS NOT NULL AND e <> ''),

        (SELECT array_agg(DISTINCT p) FROM (
            SELECT raw_payload->>'phone' p FROM mine WHERE raw_payload->>'phone' <> ''
        ) t),

        -- Выигранные: по ним видно, что клиент берёт на самом деле.
        (SELECT jsonb_agg(x) FROM (
            SELECT m.number, to_char(m.created_at, 'YYYY-MM-DD') AS date,
                   round(coalesce(m.totalsumm, 0)) AS amount, coalesce(s.name, m.status) AS status
              FROM mine m LEFT JOIN public.crm_statuses s ON (s.code = m.status OR s.external_code = m.status)
             WHERE m.status IN ('send-assembling','zagruzen-systemu','complete','otgruzen','delivering',
                                'gotov-k-otgruzke','transport-doks','chast-otgruz','doks-polucen','postoplata')
             ORDER BY m.created_at DESC LIMIT 15
        ) x),

        -- Потерянные и зависшие: здесь причины, по которым не купили.
        (SELECT jsonb_agg(x) FROM (
            SELECT m.number, to_char(m.created_at, 'YYYY-MM-DD') AS date,
                   round(coalesce(m.totalsumm, 0)) AS amount, coalesce(s.name, m.status) AS status,
                   nullif(m.prichiny_otmeny, '') AS reason
              FROM mine m LEFT JOIN public.crm_statuses s ON (s.code = m.status OR s.external_code = m.status)
             WHERE m.status NOT IN ('send-assembling','zagruzen-systemu','complete','otgruzen','delivering',
                                    'gotov-k-otgruzke','transport-doks','chast-otgruz','doks-polucen','postoplata')
             ORDER BY m.totalsumm DESC NULLS LAST LIMIT 15
        ) x),

        -- Комментарии менеджеров: хроника переговоров по каждому заказу.
        -- Свои заметки исключаем: модель не должна читать собственное эхо.
        (SELECT jsonb_agg(x) FROM (
            SELECT to_char(h.occurred_at, 'YYYY-MM-DD') AS date,
                   m.number AS order, left(h.new_value::text, 700) AS text
              FROM public.order_history_log h
              JOIN mine m ON m.order_id = h.retailcrm_order_id
             WHERE h.field = 'manager_comment' AND h.new_value IS NOT NULL
               AND h.new_value::text !~ '\d{2}\.\d{2}\.\d{4}\s+РОП:'
             ORDER BY h.occurred_at DESC LIMIT 15
        ) x),

        (SELECT jsonb_agg(x) FROM (
            SELECT to_char(r.started_at, 'YYYY-MM-DD') AS date, m.number AS order,
                   left(r.transcript, 3000) AS transcript
              FROM public.call_order_matches c
              JOIN mine m ON m.order_id = c.retailcrm_order_id
              JOIN public.raw_telphin_calls r ON r.telphin_call_id = c.telphin_call_id
             WHERE r.transcript IS NOT NULL AND length(r.transcript) > 200
             ORDER BY r.started_at DESC LIMIT 6
        ) x);
$function$;

CREATE OR REPLACE FUNCTION public.sales_order_full_history(p_order_id bigint)
 RETURNS TABLE(occurred_at timestamp with time zone, kind text, detail text)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT h.occurred_at, 'статус'::text,
           coalesce(s.name, (h.new_value::jsonb->>'code'), '?')::text
      FROM public.order_history_log h
      LEFT JOIN public.crm_statuses s ON (s.code = (h.new_value::jsonb->>'code') OR s.external_code = (h.new_value::jsonb->>'code'))
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'status'

    UNION ALL

    SELECT h.occurred_at, 'комментарий'::text, left(h.new_value::text, 600)
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'manager_comment'
       -- Свои заметки не возвращаем: иначе модель читает собственный вчерашний
       -- совет и повторяет его как факт о клиенте.
       AND h.new_value::text !~ '\d{2}\.\d{2}\.\d{4}\s+РОП:'

    UNION ALL

    -- Сумма: только величина, без служебных полей.
    SELECT h.occurred_at, 'сумма заказа'::text,
           (round(h.new_value::text::numeric)::text || ' руб')
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id
       AND h.field = 'payments.amount'
       AND h.new_value::text ~ '^[0-9.]+$'

    UNION ALL

    -- Состав: название позиции вместо JSON.
    SELECT h.occurred_at, 'позиция заказа'::text,
           coalesce(nullif(h.new_value::jsonb->'offer'->>'name', ''), 'состав изменён')
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'order_product'
       AND h.new_value::text <> 'null'

    UNION ALL

    SELECT h.occurred_at, 'дата контакта'::text, left(coalesce(h.new_value::text, ''), 40)
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'custom_data_kontakta'

    UNION ALL

    SELECT e.created_at, 'письмо'::text, left(coalesce(e.subject, ''), 200)
      FROM public.order_email_sends e
     WHERE e.order_id = p_order_id

    ORDER BY 1 DESC
    LIMIT 60;
$function$;

CREATE OR REPLACE FUNCTION public.sales_pipeline_now(p_days integer DEFAULT 45)
 RETURNS TABLE(status_name text, orders_count bigint, total_amount numeric, avg_age_days numeric)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT s.name::text, count(*), coalesce(sum(o.totalsumm), 0),
           round(avg(EXTRACT(DAY FROM now() - o.updated_at)))
      FROM public.orders o
      JOIN public.crm_statuses s ON (s.code = o.status OR s.external_code = o.status)
     WHERE o.status IN ('prepayed','availability','raschet','na-soglasovanii','v-proscete',
                        'otmenili-zakupku-smeta','ozidanie-tz','zapros-kontaktov','tender',
                        'ozhidanie-vykhoda-tendera','otlozeno','novyi-1')
       AND o.updated_at >= now() - make_interval(days => p_days)
     GROUP BY s.name
     ORDER BY 3 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.sales_rop_presale_orders()
 RETURNS TABLE(order_id bigint, number text, client text, status_code text, status_name text, amount numeric, manager_id bigint, manager_name text, telegram_username text, contact_date date, last_touch_at timestamp with time zone, site text, manager_active boolean)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT o.order_id, o.number::text,
           coalesce(o.raw_payload->'customer'->>'nickName', '')::text,
           o.status::text, coalesce(s.name, o.status)::text,
           coalesce(o.totalsumm, 0), o.manager_id,
           trim(coalesce(m.last_name, '') || ' ' || coalesce(m.first_name, ''))::text,
           coalesce(m.raw_data->>'telegram_username', '')::text,
           nullif(o.raw_payload->'customFields'->>'data_kontakta', '')::date,
           GREATEST(
               o.updated_at,
               coalesce((SELECT max(h.occurred_at) FROM public.order_history_log h
                          WHERE h.retailcrm_order_id = o.order_id), o.updated_at)
           ),
           coalesce(o.site, o.raw_payload->>'site', '')::text,
           coalesce(m.active, false)
      FROM public.orders o
      JOIN public.crm_statuses s ON (s.code = o.status OR s.external_code = o.status)
      -- Вот источник правды: разметка «в работе» из настроек ОКК.
      JOIN public.status_settings ss ON ss.code = o.status AND ss.is_working
      LEFT JOIN public.managers m ON m.id = o.manager_id
     WHERE coalesce(o.totalsumm, 0) > 0
       AND o.updated_at >= now() - interval '400 days'
       AND o.crm_deleted_at IS NULL;
$function$;

