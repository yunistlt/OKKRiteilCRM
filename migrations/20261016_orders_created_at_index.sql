-- Список заказов сортируется по orders.created_at, а индекс был только по
-- "createdAt" (поле RetailCRM). На 37 тыс. живых заказов сортировка уходила в
-- Seq Scan на 7-14 секунд и Supabase обрывал запрос по statement timeout (57014):
-- /api/orders/list отдавал 500, а интерфейс рисовал «Под этот фильтр заказов нет».
--
-- Индекс частичный: в рабочем списке удалённые в CRM заказы не показываются.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at_alive
    ON public.orders USING btree (created_at DESC)
    WHERE crm_deleted_at IS NULL;

-- У таблицы ни разу не собиралась статистика (last_analyze пуст), планировщик
-- считал, что в ней десяток строк.
ANALYZE public.orders;
