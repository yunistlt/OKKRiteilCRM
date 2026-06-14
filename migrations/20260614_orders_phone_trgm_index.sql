-- PERF: ускоряем матчинг звонков с заказами.
-- lib/call-matching.ts (findOrderCandidatesByPhone) делает поиск по суффиксу телефона
-- через leading-wildcard ILIKE ('%suffix%') по orders.phone и raw_payload->>'additionalPhone'.
-- Такой ILIKE не может использовать обычный B-tree индекс => full scan на каждый звонок
-- (крон call-match раз в минуту + match-backfill). Триграммные GIN-индексы делают '%...%'
-- индексным поиском.
--
-- Аддитивно и безопасно: только добавляет расширение и индексы, поведение запросов не меняется.
-- Применяется как есть в Supabase SQL Editor / любом транзакционном раннере.
-- На время построения индекса берётся блокировка записи в orders (для разового прогона ок).
--
-- Опционально (psql, БЕЗ блокировки записи): постройте индексы с CONCURRENTLY — но тогда
-- каждую команду нужно выполнять ОТДЕЛЬНО и НЕ в транзакции, например:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_phone_trgm
--       ON orders USING gin (phone gin_trgm_ops);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_additional_phone_trgm
--       ON orders USING gin ((raw_payload->>'additionalPhone') gin_trgm_ops);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_phone_trgm
    ON orders USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_additional_phone_trgm
    ON orders USING gin ((raw_payload->>'additionalPhone') gin_trgm_ops);
