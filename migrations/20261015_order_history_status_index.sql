-- Индекс под историю статусов: без него вечерний отчёт прочитывал всю
-- таблицу истории (931 088 строк) и упирался в таймаут.
-- CONCURRENTLY — чтобы не запирать запись в рабочее время.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_history_status_facts
    ON public.order_history_log (retailcrm_order_id, occurred_at)
    INCLUDE (new_value)
    WHERE field = 'status';
