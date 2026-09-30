-- Кто из контактных лиц относится к какому клиенту.
--
-- Первая попытка связывала контакт с `company` из заказа — это оказалось не то:
-- наши карточки клиентов (`clients`) хранят покупателя заказа
-- (`customer.id`), а контактное лицо лежит в `contact.id`. Проверено на живых
-- заказах: №54899 — покупатель 74441 «ООО Спстрим», контакт 48824 с телефоном.
-- Неверную таблицу убираем, вместо неё заводим правильную.

DROP TABLE IF EXISTS public.customer_companies;

CREATE TABLE IF NOT EXISTS public.client_contacts (
    client_id    BIGINT NOT NULL,   -- clients.id, он же customer.id заказа
    contact_id   BIGINT NOT NULL,   -- customers.id, он же contact.id заказа
    orders_count INTEGER NOT NULL DEFAULT 0,
    last_order_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_contact ON public.client_contacts (contact_id);

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.client_contacts;
CREATE POLICY "service role full access" ON public.client_contacts FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.client_contacts IS
  'Контактные лица клиента, выведенные из заказов: кто и сколько раз заказывал';
