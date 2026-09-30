-- Контактные лица RetailCRM своей таблицей.
--
-- Почему понадобилось: в RetailCRM две сущности — юрлица (20 708) и контактные
-- лица (45 248). У нас синхронизировались только юрлица, а телефоны и почта
-- живут у контактов. Из-за этого колонка телефонов в карточках клиентов была
-- пуста у всех 20 699 записей.
--
-- Структура один в один, имена полей — их. Связь контакта с юрлицом строим по
-- заказам: там уже лежат и покупатель, и его компания, а тянуть её отдельными
-- запросами — это 20 708 обращений к их API.

CREATE TABLE IF NOT EXISTS public.customers (
    "id"              BIGINT PRIMARY KEY,
    "externalId"      TEXT,
    "firstName"       TEXT,
    "lastName"        TEXT,
    "patronymic"      TEXT,
    "email"           TEXT,
    "phones"          TEXT[],
    "site"            TEXT,
    "managerId"       BIGINT,
    "vip"             BOOLEAN,
    "bad"             BOOLEAN,
    "isContact"       BOOLEAN,
    "createdAt"       TIMESTAMPTZ,
    "ordersCount"     INTEGER,
    "totalSumm"       NUMERIC,
    "averageSumm"     NUMERIC,
    "personalDiscount" NUMERIC,
    "segments"        JSONB,
    "customFields"    JSONB,
    raw               JSONB,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Какой контакт какому юрлицу принадлежит — по факту заказов.
CREATE TABLE IF NOT EXISTS public.customer_companies (
    customer_id  BIGINT NOT NULL,
    company_id   BIGINT NOT NULL,
    orders_count INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (customer_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers ("email");
CREATE INDEX IF NOT EXISTS idx_customers_phones ON public.customers USING gin ("phones");
CREATE INDEX IF NOT EXISTS idx_customers_manager ON public.customers ("managerId");
CREATE INDEX IF NOT EXISTS idx_customer_companies_company ON public.customer_companies (company_id);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.customers;
CREATE POLICY "service role full access" ON public.customers FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service role full access" ON public.customer_companies;
CREATE POLICY "service role full access" ON public.customer_companies FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.customers IS 'Контактные лица RetailCRM: телефоны, почта, кто менеджер';
COMMENT ON TABLE public.customer_companies IS 'Связь контакта с юрлицом, выведенная из заказов';
