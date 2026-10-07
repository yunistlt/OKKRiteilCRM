-- ============================================================================
-- Индексы для подбора карточек клиента в поиске заказов.
--
-- Поиск заказа по покупателю сначала подбирает подходящие карточки клиентов
-- (clients — наши, customers — приехавшие из RetailCRM), и только потом ищет
-- заказы. На 20 792 + 45 302 карточках без индексов этот подбор занимал
-- 0,6–0,8 с, и весь поиск доходил до трёх секунд.
--
-- Жалоба Ксении 07.10.2026: «сильно лагает и замедляет нашу работу».
-- ============================================================================

CREATE INDEX IF NOT EXISTS clients_company_name_trgm ON public.clients USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_contact_name_trgm ON public.clients USING gin (contact_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_email_trgm ON public.clients USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_inn_trgm ON public.clients USING gin (inn gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_first_name_trgm ON public.clients USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_last_name_trgm ON public.clients USING gin (last_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_first_name_trgm ON public.customers USING gin ("firstName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_last_name_trgm ON public.customers USING gin ("lastName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_email_trgm ON public.customers USING gin (email gin_trgm_ops);
