-- Правка физлиц (контактных лиц) в ОКК.
--
-- Решение владельца 02.10.2026: ФИО, телефоны и почту человека правим у себя,
-- в RetailCRM эти правки не отправляем. Значит синхронизация контактов
-- (lib/retailcrm/customers-sync.ts) не должна затирать их данными из CRM:
-- отмечаем строку, правленную у нас, и синк её личные поля больше не трогает.
--
-- Та же защита уже стоит на реквизитах клиента (clients.requisites_updated_at).

ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS okk_edited_at timestamptz,
    ADD COLUMN IF NOT EXISTS okk_edited_by text;

COMMENT ON COLUMN public.customers.okk_edited_at IS
    'Когда данные человека правили в ОКК. Заполнено — синхронизация RetailCRM не перезаписывает ФИО, телефоны и почту.';
COMMENT ON COLUMN public.customers.okk_edited_by IS 'Кто правил данные человека в ОКК.';

CREATE INDEX IF NOT EXISTS customers_okk_edited_idx
    ON public.customers (okk_edited_at)
    WHERE okk_edited_at IS NOT NULL;
