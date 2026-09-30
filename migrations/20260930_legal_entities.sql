-- Ставка НДС и подписанты — в карточке нашего юрлица.
--
-- Справочник юрлиц уже есть (`legal_entities`, заведён юридическим блоком
-- 29.09.2026): ИНН, название, тип, активность. Второй справочник заводить
-- нельзя — одна сущность живёт в одной таблице. Дополняем её тем, чего не
-- хватает для документов.
--
-- Почему это настройка, а не код: ставка НДС у каждого юрлица своя (ИП на
-- упрощённой — без НДС, у ООО своя ставка), и меняется она решением человека,
-- а не выкаткой. В RetailCRM такого поля нет.
--
-- `site_code` связывает юрлицо с магазином RetailCRM: оттуда берутся банковские
-- реквизиты, а отсюда — ставка налога.

ALTER TABLE public.legal_entities
    ADD COLUMN IF NOT EXISTS vat_percent  NUMERIC,
    ADD COLUMN IF NOT EXISTS site_code    TEXT,
    ADD COLUMN IF NOT EXISTS signer_name  TEXT,
    ADD COLUMN IF NOT EXISTS signer_title TEXT;

CREATE INDEX IF NOT EXISTS idx_legal_entities_site ON public.legal_entities (site_code);

COMMENT ON COLUMN public.legal_entities.vat_percent IS
  'Ставка НДС в процентах: задаёт человек в карточке юрлица, в коде не зашита';
COMMENT ON COLUMN public.legal_entities.site_code IS
  'Код магазина RetailCRM — оттуда берутся банковские реквизиты этого юрлица';
COMMENT ON COLUMN public.legal_entities.signer_name IS 'Кто подписывает документы';
COMMENT ON COLUMN public.legal_entities.signer_title IS 'Должность подписанта';
