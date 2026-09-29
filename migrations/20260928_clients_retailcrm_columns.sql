-- K-1: свои поля клиента из RetailCRM переезжают в колонки таблицы clients.
-- Структура один в один: имена — их коды, русское название в COMMENT.
-- Стандартные поля покупателя в clients уже есть (заведены при синхронизации),
-- здесь только свои поля из справочника retailcrm_custom_fields
-- (entity = customer и customer_corporate).
--
-- Поле customer_corporate.site («Адрес сайта») НЕ берём: в clients уже есть
-- колонка site — это магазин заказа, другое значение. Коллизию имён решаем
-- отдельно, молча переписывать смысл колонки нельзя.
--
-- Миграция только добавляет.

ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS "kategoria_klienta" TEXT,
    ADD COLUMN IF NOT EXISTS "kategoria_klienta_po_vidu" TEXT,
    ADD COLUMN IF NOT EXISTS "instagram" TEXT,
    ADD COLUMN IF NOT EXISTS "gcid" TEXT,
    ADD COLUMN IF NOT EXISTS "ycid" TEXT,
    ADD COLUMN IF NOT EXISTS "doubleemail" NUMERIC,
    ADD COLUMN IF NOT EXISTS "dublephone" NUMERIC,
    ADD COLUMN IF NOT EXISTS "ai_last_order_number" TEXT,
    ADD COLUMN IF NOT EXISTS "ai_reactivation_text" TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_kategoria ON public.clients ("kategoria_klienta");
CREATE INDEX IF NOT EXISTS idx_clients_forma_zakupki ON public.clients ("kategoria_klienta_po_vidu");

COMMENT ON COLUMN public.clients."kategoria_klienta" IS 'Категория товара';
COMMENT ON COLUMN public.clients."kategoria_klienta_po_vidu" IS 'Форма закупки';
COMMENT ON COLUMN public.clients."instagram" IS 'Instagram';
COMMENT ON COLUMN public.clients."gcid" IS 'Google Client ID';
COMMENT ON COLUMN public.clients."ycid" IS 'Yandex Client ID';
COMMENT ON COLUMN public.clients."doubleemail" IS 'Кол-во дублей по email';
COMMENT ON COLUMN public.clients."dublephone" IS 'Кол-во дублей по телефону';
COMMENT ON COLUMN public.clients."ai_last_order_number" IS 'ИИ последний номер заказа';
COMMENT ON COLUMN public.clients."ai_reactivation_text" IS 'ИИ реанимация текст';
