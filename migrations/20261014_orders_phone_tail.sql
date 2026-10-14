-- Поиск заказа по номеру звонящего: сравнивать надо цифры, а не строку.
-- У 864 заказов из 35 941 телефон записан с разделителями («+7-906-708-28-04»,
-- «8 (903) 122-92-86», «+79951140290 Мария»), и поиск подстрокой их не находил:
-- входящий от клиента Матвеевой уходил в общую очередь.
-- Считаем хвост из 7 цифр вычисляемой колонкой — она не расходится с phone
-- никогда и не зависит от того, кто пишет в заказ (синк, триггеры, наша правка).
-- Аддитивно и идемпотентно.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'phone_tail7'
    ) THEN
        ALTER TABLE public.orders
            ADD COLUMN phone_tail7 TEXT
            GENERATED ALWAYS AS (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 7)) STORED;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'additional_phone_tail7'
    ) THEN
        ALTER TABLE public.orders
            ADD COLUMN additional_phone_tail7 TEXT
            GENERATED ALWAYS AS (right(regexp_replace(coalesce(raw_payload->>'additionalPhone', ''), '\D', '', 'g'), 7)) STORED;
    END IF;
END $$;

COMMENT ON COLUMN public.orders.phone_tail7 IS
    'Последние 7 цифр телефона заказа — ключ поиска «чей клиент звонит» (вычисляется, вручную не писать)';
COMMENT ON COLUMN public.orders.additional_phone_tail7 IS
    'Последние 7 цифр дополнительного телефона заказа (вычисляется, вручную не писать)';

CREATE INDEX IF NOT EXISTS idx_orders_phone_tail7 ON public.orders (phone_tail7) WHERE phone_tail7 <> '';
CREATE INDEX IF NOT EXISTS idx_orders_additional_phone_tail7 ON public.orders (additional_phone_tail7) WHERE additional_phone_tail7 <> '';

NOTIFY pgrst, 'reload config';
