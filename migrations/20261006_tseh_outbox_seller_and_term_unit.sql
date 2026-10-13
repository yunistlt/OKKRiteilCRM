-- Производству нужны ещё два факта о заказе (замечания логистики 06.10.2026):
--
-- 1. От какого НАШЕГО юрлица выставлен счёт — в карточке ЦехУспеха поле
--    «поставщик» остаётся пустым, и там не видно, на какие реквизиты оплачено.
-- 2. В каких днях назван срок изготовления. Менеджер пишет календарные, а
--    ЦехУспех считал рабочими — на сроке 40 дней расхождение в две недели.
--
-- Проверено перед заведением: таких колонок в tseh_production_outbox нет
-- (information_schema), юрлицо нигде в очередь не писалось.
-- Миграция добавочная: старые строки остаются валидными.

ALTER TABLE public.tseh_production_outbox
    ADD COLUMN IF NOT EXISTS seller_name          text,
    ADD COLUMN IF NOT EXISTS seller_inn           text,
    ADD COLUMN IF NOT EXISTS seller_account       text,
    ADD COLUMN IF NOT EXISTS seller_bank          text,
    ADD COLUMN IF NOT EXISTS production_days_unit text;

COMMENT ON COLUMN public.tseh_production_outbox.seller_name IS 'Наше юрлицо, от которого выставлен счёт (поставщик в ЦехУспехе)';
COMMENT ON COLUMN public.tseh_production_outbox.seller_inn IS 'ИНН нашего юрлица — по нему ЦехУспех однозначно находит поставщика';
COMMENT ON COLUMN public.tseh_production_outbox.seller_account IS 'Расчётный счёт нашего юрлица: на какие реквизиты оплачено';
COMMENT ON COLUMN public.tseh_production_outbox.seller_bank IS 'Банк нашего юрлица';
COMMENT ON COLUMN public.tseh_production_outbox.production_days_unit IS 'В каких днях назван срок: kalendarnye или rabochie (по умолчанию календарные)';
