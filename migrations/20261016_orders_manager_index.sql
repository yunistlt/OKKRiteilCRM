-- Заказы одного менеджера — без перебора всей таблицы.
--
-- «Мой день» собирался 54 секунды: чтобы показать дела одного человека, база
-- перебирала все 38 тыс. заказов и выбрасывала 27 тыс. чужих (16 секунд на
-- запрос, а их там несколько). Индекса по менеджеру не было ни одного.
--
-- Частичный: удалённые в CRM заказы ни в одном рабочем экране не участвуют.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_manager_alive
    ON public.orders USING btree (manager_id)
    WHERE crm_deleted_at IS NULL;

-- Список заказов сортируется «новые сверху» и просит пустые даты в конец
-- (DESC NULLS LAST). Индекс без NULLS LAST под такой порядок не подходит —
-- 16.10.2026 из-за этого список читался целиком по 14 секунд и отдавал отказ.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at_alive_nl
    ON public.orders USING btree (created_at DESC NULLS LAST)
    WHERE crm_deleted_at IS NULL;
