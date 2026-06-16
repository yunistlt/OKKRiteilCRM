-- Фикс таймаута claim_calls_for_external_stt (см. 20260615_claim_calls_for_external_stt.sql).
-- Симптом: /api/stt/claim начал отдавать 500 "canceling statement due to statement timeout"
-- (16.06.2026 ~02:05 UTC), пропускная способность внешнего STT-воркера упала с ~60/час до 2–6/час.
--
-- Причина: в EXISTS-подзапросе джоин orders ↔ call_order_matches идёт по o.id::text = m.retailcrm_order_id::text.
-- orders.id это bigint, retailcrm_order_id это integer — приведение обеих сторон к text делает orders_pkey
-- бесполезным, и планировщик СКАНИРУЕТ всю таблицу orders (~29k строк) на КАЖДУЮ строку-кандидата.
-- По мере того как воркер выгребал свежие звонки, скан по started_at DESC уходил всё глубже и упирался
-- в statement_timeout (~8с). EXPLAIN: Seq Scan on orders, loops≈1044, 1.7M buffers, 7.2с.
--
-- Решение: выражённый (expression) индекс по (id::text), точно совпадающий с предикатом джоина.
-- Превращает Seq Scan в Index Scan. После фикса тот же запрос: 7245мс → 76мс.
-- Логику функции не меняем — индекс достаточен.
--
-- CONCURRENTLY — чтобы не блокировать orders на проде. Запускать ВНЕ транзакции (по одному стейтменту).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_id_text ON orders ((id::text));

ANALYZE orders;
