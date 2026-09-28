-- Z-2: поля заказа RetailCRM переезжают из raw_payload в колонки.
-- Имена колонок — как у RetailCRM, один в один, без перевода и без snake_case:
-- отсюда кавычки в SQL. Это осознанная цена решения «берём их структуру».
-- Миграция только добавляет. raw_payload остаётся на месте, старые колонки
-- (number, status, totalsumm, phone, site, manager_id) не трогаем.

ALTER TABLE public.orders
    -- строки
    ADD COLUMN IF NOT EXISTS "orderType" TEXT,
    ADD COLUMN IF NOT EXISTS "orderMethod" TEXT,
    ADD COLUMN IF NOT EXISTS "countryIso" TEXT,
    ADD COLUMN IF NOT EXISTS "currency" TEXT,
    ADD COLUMN IF NOT EXISTS "privilegeType" TEXT,
    ADD COLUMN IF NOT EXISTS "managerComment" TEXT,
    ADD COLUMN IF NOT EXISTS "statusComment" TEXT,
    ADD COLUMN IF NOT EXISTS "customerComment" TEXT,
    ADD COLUMN IF NOT EXISTS "firstName" TEXT,
    ADD COLUMN IF NOT EXISTS "lastName" TEXT,
    ADD COLUMN IF NOT EXISTS "patronymic" TEXT,
    ADD COLUMN IF NOT EXISTS "email" TEXT,
    ADD COLUMN IF NOT EXISTS "additionalPhone" TEXT,
    ADD COLUMN IF NOT EXISTS "shipmentStore" TEXT,
    ADD COLUMN IF NOT EXISTS "externalId" TEXT,
    -- даты (в payload это строки, храним временем)
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "statusUpdatedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "markDatetime" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "fullPaidAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "shipmentDate" DATE,
    -- числа
    ADD COLUMN IF NOT EXISTS "slug" BIGINT,
    ADD COLUMN IF NOT EXISTS "summ" NUMERIC,
    ADD COLUMN IF NOT EXISTS "prepaySum" NUMERIC,
    ADD COLUMN IF NOT EXISTS "purchaseSumm" NUMERIC,
    ADD COLUMN IF NOT EXISTS "bonusesChargeTotal" NUMERIC,
    ADD COLUMN IF NOT EXISTS "bonusesCreditTotal" NUMERIC,
    ADD COLUMN IF NOT EXISTS "personalDiscountPercent" NUMERIC,
    ADD COLUMN IF NOT EXISTS "weight" NUMERIC,
    ADD COLUMN IF NOT EXISTS "width" NUMERIC,
    ADD COLUMN IF NOT EXISTS "height" NUMERIC,
    ADD COLUMN IF NOT EXISTS "length" NUMERIC,
    -- да/нет
    ADD COLUMN IF NOT EXISTS "call" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "expired" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "fromApi" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "shipped" BOOLEAN,
    -- вложенные объекты целиком: разбирать их будем отдельными шагами
    ADD COLUMN IF NOT EXISTS "delivery" JSONB,
    ADD COLUMN IF NOT EXISTS "contragent" JSONB,
    ADD COLUMN IF NOT EXISTS "contact" JSONB,
    ADD COLUMN IF NOT EXISTS "company" JSONB,
    ADD COLUMN IF NOT EXISTS "source" JSONB,
    ADD COLUMN IF NOT EXISTS "loyaltyLevel" JSONB,
    ADD COLUMN IF NOT EXISTS "links" JSONB;

-- Часто спрашиваемое: ИНН контрагента (есть у 36% заказов) и дата создания.
CREATE INDEX IF NOT EXISTS idx_orders_contragent_inn
    ON public.orders ((("contragent"->>'INN')));
CREATE INDEX IF NOT EXISTS idx_orders_created_at_crm
    ON public.orders ("createdAt" DESC);

COMMENT ON COLUMN public.orders."orderType" IS 'RetailCRM orderType, код типа заказа';
COMMENT ON COLUMN public.orders."contragent" IS 'RetailCRM contragent целиком: ИНН, КПП, банк, юрадрес';
