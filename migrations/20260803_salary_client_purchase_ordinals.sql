-- ============================================================================
-- Порядковый номер покупки клиента — данные для блока «Доплата за повторную
-- покупку» (превращение разового клиента в постоянного).
--
-- Задача бизнеса: платить менеджеру за то, что клиент вернулся — отдельно за
-- 2-ю, 3-ю, 6-ю покупку (набор порогов настраивается в конструкторе схем).
--
-- Разбор данных за 2025-01…2026-08 (scratch/probe-final.mjs):
--   покупка 1 — 823 клиента, 2-я — 128, 3-я — 35, 6-я — 6.
--   За последние 12 мес: вторых 90, третьих 24, шестых 3, менеджеров 4.
--
-- Интервал между покупками намеренно не учитывается: по решению бизнеса важен
-- сам факт возврата клиента, а не скорость возврата.
--
-- Что считается покупкой — ровно то же, что членством в числителе конверсии
-- (salary_counted_orders): заказ, вошедший в закрывающий статус, по истории
-- ЛИБО по текущему статусу. Определение НЕ дублируется по смыслу, но копируется
-- по коду: при изменении канона правь обе функции.
--
-- Клиент берётся из raw_payload->customer->id (orders.client_id синк не пишет),
-- с фолбэком на колонку — та же канва, что в salary_counted_orders.
--
-- Номер покупки считается НА МОМЕНТ входа заказа в производство (оконная
-- функция по возрастанию даты), а не «сколько всего сделок у клиента сейчас».
-- Иначе выплата задним числом мигала бы: клиент купил третий раз в августе —
-- и мартовский заказ внезапно стал бы «третьим».
-- ============================================================================

DROP FUNCTION IF EXISTS public.salary_client_purchase_ordinals(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.salary_client_purchase_ordinals(timestamp with time zone, timestamp with time zone, text);
CREATE OR REPLACE FUNCTION public.salary_client_purchase_ordinals(
    p_start timestamptz,
    p_end timestamptz,
    p_closing text
)
RETURNS TABLE(order_id bigint, client_id bigint, ordinal bigint)
LANGUAGE sql STABLE AS $$
    WITH hist AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    stat AS (
        SELECT o.order_id AS oid, (o.raw_payload->>'statusUpdatedAt')::timestamptz AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o.raw_payload->>'statusUpdatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM stat
    ),
    canon AS (
        SELECT i.oid, COALESCE(h.d, s.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
    ),
    purchases AS (
        SELECT c.oid,
               COALESCE(
                   CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                        THEN (o.raw_payload->'customer'->>'id')::bigint END,
                   o.client_id
               ) AS cid,
               c.entered_at
        FROM canon c
        JOIN public.orders o ON o.order_id = c.oid
        WHERE c.entered_at IS NOT NULL
    ),
    ranked AS (
        -- Тай-брейк по oid: две покупки одной секундой должны нумероваться
        -- детерминированно, иначе доплата «прыгает» между заказами при пересчёте.
        SELECT p.oid, p.cid, p.entered_at,
               row_number() OVER (PARTITION BY p.cid ORDER BY p.entered_at, p.oid) AS rn
        FROM purchases p
        WHERE p.cid IS NOT NULL
    )
    SELECT r.oid, r.cid, r.rn
    FROM ranked r
    WHERE r.entered_at >= p_start AND r.entered_at < p_end;
$$;
