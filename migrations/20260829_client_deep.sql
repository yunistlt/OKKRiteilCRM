-- Глубокая часть досье клиента: то, чего не было в кратком.
--
-- Краткое досье отвечало «что покупал». Для разговора нужно другое: где мы не
-- дожали (потерянные сделки и причины отказа), что писали менеджеры по каждому
-- заказу, что говорил сам клиент в трубку и как с ним связаться.
--
-- Клиент склеивается по ИНН: одно юрлицо заведено в CRM несколькими карточками,
-- и без склейки постоянный клиент выглядит как несколько случайных.
CREATE OR REPLACE FUNCTION public.sales_client_deep(p_client_key text)
RETURNS TABLE (
    customer_ids bigint[],
    emails text[],
    phones text[],
    won_orders jsonb,
    lost_orders jsonb,
    comments jsonb,
    calls jsonb
)
LANGUAGE sql STABLE AS $function$
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
              FROM mine m LEFT JOIN public.statuses s ON s.code = m.status
             WHERE m.status IN ('send-assembling','zagruzen-systemu','complete','otgruzen','delivering',
                                'gotov-k-otgruzke','transport-doks','chast-otgruz','doks-polucen','postoplata')
             ORDER BY m.created_at DESC LIMIT 15
        ) x),

        -- Потерянные и зависшие: здесь причины, по которым не купили.
        (SELECT jsonb_agg(x) FROM (
            SELECT m.number, to_char(m.created_at, 'YYYY-MM-DD') AS date,
                   round(coalesce(m.totalsumm, 0)) AS amount, coalesce(s.name, m.status) AS status,
                   nullif(m.prichiny_otmeny, '') AS reason
              FROM mine m LEFT JOIN public.statuses s ON s.code = m.status
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

GRANT EXECUTE ON FUNCTION public.sales_client_deep(text) TO service_role;
