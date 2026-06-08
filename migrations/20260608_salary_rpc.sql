-- ============================================================================
-- Зарплатный модуль (Фаза 3): RPC-функции сбора метрик.
-- Реляционная тяжёлая часть (join истории статусов, история сделок клиента,
-- входящие за период) — в SQL; парсинг raw_payload и конфиг-тиры — в lib/salary.
-- ============================================================================

-- Заказы, ВОШЕДШИЕ в статус «закрытия» (p_closing) в окне [p_start, p_end).
-- entered_at — момент первого перехода в этот статус внутри окна.
CREATE OR REPLACE FUNCTION public.salary_counted_orders(
    p_start timestamptz, p_end timestamptz, p_closing text
)
RETURNS TABLE(
    order_id bigint, manager_id bigint, client_id bigint,
    entered_at timestamptz, totalsumm numeric,
    order_method text, typ_castomer text, created_at timestamptz, items jsonb
)
LANGUAGE sql STABLE AS $$
    WITH trans AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS entered_at
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
          AND h.occurred_at >= p_start AND h.occurred_at < p_end
        GROUP BY h.retailcrm_order_id
    )
    SELECT o.order_id, o.manager_id, o.client_id, t.entered_at, o.totalsumm,
           o.raw_payload->>'orderMethod' AS order_method,
           o.raw_payload->'customFields'->>'typ_castomer' AS typ_castomer,
           o.created_at,
           o.raw_payload->'items' AS items
    FROM trans t
    JOIN public.orders o ON o.order_id = t.oid;
$$;

-- Сколько раз заказы клиента ВООБЩЕ доходили до статуса «закрытия» (за всё время).
-- Для классификации новый/постоянный (> порога = постоянный).
CREATE OR REPLACE FUNCTION public.salary_client_deal_counts(
    p_client_ids bigint[], p_closing text
)
RETURNS TABLE(client_id bigint, deals bigint)
LANGUAGE sql STABLE AS $$
    SELECT o.client_id, count(DISTINCT h.retailcrm_order_id)
    FROM public.order_history_log h
    JOIN public.orders o ON o.order_id = h.retailcrm_order_id
    WHERE h.field = 'status'
      AND h.new_value LIKE '%"code":"' || p_closing || '"%'
      AND o.client_id = ANY(p_client_ids)
    GROUP BY o.client_id;
$$;

-- Входящие заявки за период по менеджеру (созданы в окне, источник не в исключениях).
-- Знаменатель конверсии.
CREATE OR REPLACE FUNCTION public.salary_incoming_counts(
    p_start timestamptz, p_end timestamptz, p_exclusions text[]
)
RETURNS TABLE(manager_id bigint, incoming bigint)
LANGUAGE sql STABLE AS $$
    SELECT o.manager_id, count(*)
    FROM public.orders o
    WHERE o.created_at >= p_start AND o.created_at < p_end
      AND COALESCE(o.raw_payload->>'orderMethod', '') <> ALL(p_exclusions)
    GROUP BY o.manager_id;
$$;

-- Дополняем нормализацию НДС значением 20% (реальные vatRate в данных: 0/5/20/none).
UPDATE public.salary_config
SET value = '{"rules":[{"vat_pct":0,"divisor":1.0},{"vat_pct":5,"divisor":1.05},{"vat_pct":20,"divisor":1.20}]}'::jsonb,
    note = 'Приведение к «без НДС»: 5%→/1.05, 20%→/1.20, 0%/none→как есть'
WHERE key = 'nds_normalization' AND effective_from = '2026-07-01';
