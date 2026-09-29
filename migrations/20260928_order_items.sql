-- Z-3: позиции заказа отдельной таблицей, структура RetailCRM один в один.
-- Имена полей — их, ключ — их id позиции. Вложенные объекты (offer, prices,
-- discounts, properties, priceType) храним целиком, как в orders: разбирать их
-- будем отдельным шагом, когда появится свой справочник номенклатуры (T-2).
-- Таблица только добавляется, raw_payload остаётся полной копией.

CREATE TABLE IF NOT EXISTS public.order_items (
    "id"                  BIGINT PRIMARY KEY,          -- id позиции в RetailCRM
    order_id              BIGINT NOT NULL,             -- id заказа в RetailCRM (orders.order_id)
    "quantity"            NUMERIC,
    "initialPrice"        NUMERIC,
    "purchasePrice"       NUMERIC,
    "discountTotal"       NUMERIC,
    "bonusesChargeTotal"  NUMERIC,
    "bonusesCreditTotal"  NUMERIC,
    "status"              TEXT,
    "vatRate"             TEXT,
    "comment"             TEXT,
    "ordering"            INTEGER,
    "isCanceled"          BOOLEAN,
    "createdAt"           TIMESTAMPTZ,
    "offer"               JSONB,   -- товар: id, name, article, xmlId, unit
    "priceType"           JSONB,
    "prices"              JSONB,
    "discounts"           JSONB,
    "properties"          JSONB,
    "markingObjects"      JSONB,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_article ON public.order_items ((("offer"->>'article')));
CREATE INDEX IF NOT EXISTS idx_order_items_xml ON public.order_items ((("offer"->>'xmlId')));

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.order_items;
CREATE POLICY "service role full access" ON public.order_items FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE  public.order_items IS 'Позиции заказа RetailCRM, структура один в один';
COMMENT ON COLUMN public.order_items."offer" IS 'Товар: наименование, артикул, xmlId, единица измерения';
COMMENT ON COLUMN public.order_items."initialPrice" IS 'Цена за единицу до скидки';
COMMENT ON COLUMN public.order_items."discountTotal" IS 'Скидка на позицию, рублей';
