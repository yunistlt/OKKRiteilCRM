-- Контакты юрлица для бланка счёта и КП (замечание Лены Парфёновой
-- 05.10.2026: «счёт не на фирменном бланке, без наших контактов»).
--
-- Значения по умолчанию взяты из прежних документов ЗМК, которые уходили
-- клиентам из RetailCRM. Меняются в настройках юрлица, без выкатки.
ALTER TABLE public.legal_entities
    ADD COLUMN IF NOT EXISTS phone text,
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS site_url text;

UPDATE public.legal_entities
SET phone = COALESCE(phone, '+7 499 350-44-90'),
    email = COALESCE(email, 'rop@zmktlt.ru'),
    site_url = COALESCE(site_url, 'zmktlt.ru');

COMMENT ON COLUMN public.legal_entities.phone IS 'Телефон в шапке счёта и КП';
