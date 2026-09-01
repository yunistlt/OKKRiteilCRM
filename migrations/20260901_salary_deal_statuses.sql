-- ============================================================================
-- Счётчик покупок клиента: засчитываем не только текущий closing_status, но и
-- статусы «покупка состоялась» (заказ прошёл производство и ушёл дальше).
-- Причина: order_history_log ведётся не с начала времён, у заказов 2021–2023 нет
-- события send-assembling, а их текущий статус — «Заказ отгружен»/«Выполнен».
-- Из-за этого постоянный клиент считался новым (инцидент по заказу 54232,
-- ООО «ХРС-Снабжение»: 6-я покупка засчиталась как первая → ставка 3000 вместо 1000).
-- Список статусов — в конфиге (deal_statuses), ноль хардкода.
-- Аддитивно: новый параметр p_deal_statuses (DEFAULT NULL — старые вызовы не ломаются).
-- ============================================================================

INSERT INTO salary_config (key, value, effective_from, note, created_by)
VALUES (
  'deal_statuses',
  '["send-assembling","otgruzen","complete","delivering","send-to-delivery","reklamac"]'::jsonb,
  '2020-01-01',
  'Статусы состоявшейся покупки (для счётчика сделок клиента: новый/постоянный)',
  'migration'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

DROP FUNCTION IF EXISTS public.salary_client_deal_counts(bigint[], text);

CREATE OR REPLACE FUNCTION public.salary_client_deal_counts(p_client_ids bigint[], p_closing text, p_deal_statuses text[] DEFAULT NULL::text[])
 RETURNS TABLE(client_id bigint, deals bigint)
 LANGUAGE sql
 STABLE
AS $function$
    WITH client_orders AS (
        SELECT o.order_id,
               public.salary_canon_client(COALESCE(
                       CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                            THEN (o.raw_payload->'customer'->>'id')::bigint END,
                       o.client_id
                   )) AS cid
        FROM public.orders o
        WHERE o.status = p_closing
           OR (p_deal_statuses IS NOT NULL AND o.status = ANY(p_deal_statuses))
        UNION
        SELECT o.order_id,
               public.salary_canon_client(COALESCE(
                       CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                            THEN (o.raw_payload->'customer'->>'id')::bigint END,
                       o.client_id
                   )) AS cid
        FROM public.order_history_log h
        JOIN public.orders o ON o.order_id = h.retailcrm_order_id
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
    )
    SELECT cid AS client_id, count(DISTINCT order_id) AS deals
    FROM client_orders
    WHERE cid = ANY(p_client_ids)
    GROUP BY cid;
$function$;
