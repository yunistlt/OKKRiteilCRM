-- Номер созданного заказа (человекочитаемый) для кликабельной ссылки в RetailCRM на экране секретаря.
ALTER TABLE public.incoming_emails
    ADD COLUMN IF NOT EXISTS created_crm_order_number TEXT;
