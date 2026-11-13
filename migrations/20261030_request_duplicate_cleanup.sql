-- ============================================================================
-- Хвост от 20261030_request_duplicate_statuses.sql. НАКАТЫВАТЬ ТОЛЬКО ПОСЛЕ
-- выкатки кода на прод — до неё старый ключ и старые сигнатуры держат рабочим
-- уже выкаченный код.
--
-- Что убираем:
--   1) `duplicate_status` из значения правила — код читает `duplicate_statuses`;
--   2) функции конверсии со старым аргументом `p_req_status text` — их больше
--      никто не зовёт, а оставленными они путают: правило в них одно-кодовое.
-- ============================================================================

UPDATE salary_config
   SET value = value - 'duplicate_status'
 WHERE key = 'request_duplicate_rule'
   AND value ? 'duplicate_statuses';

DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[], text, text[], text[], text[], text[], text, text, text[], text[], text[], numeric, boolean);
DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamptz, timestamptz, text, text, text[], text[], text[], text, text, text[], text[], text[], text[], text[], numeric, boolean);
