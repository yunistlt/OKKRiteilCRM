-- Позиции заказа тоже должны обновляться сами.
--
-- Бэкфилл 28.09.2026 перенёс 43 521 позицию разово, а дальше таблица начала
-- отставать: заказ 54872 от 29.09 уже имел позицию в raw_payload, но не в
-- order_items. Тот же приём, что и для колонок заказа: перекладываем состав из
-- JSON при каждой записи заказа.
--
-- Триггер AFTER: сначала заказ сохраняется, потом обновляется его состав.
-- Сбой разбора не мешает сохранению заказа — уходит в WARNING.
-- Пишет только в order_items, свою таблицу; raw_payload не трогает.
--
-- Снимается одной строкой:
--   DROP TRIGGER order_items_sync ON public.orders;

CREATE OR REPLACE FUNCTION public.order_items_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    crm_order_id BIGINT := COALESCE(NEW.order_id, NEW.id);
BEGIN
    IF NEW.raw_payload IS NULL
       OR jsonb_typeof(NEW.raw_payload->'items') <> 'array' THEN
        RETURN NULL;
    END IF;

    -- Позиции, которых в свежем составе больше нет (менеджер удалил строку).
    DELETE FROM public.order_items oi
     WHERE oi.order_id = crm_order_id
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(NEW.raw_payload->'items') el
            WHERE (el->>'id')::bigint = oi."id"
       );

    INSERT INTO public.order_items (
        "id", order_id, "quantity", "initialPrice", "purchasePrice", "discountTotal",
        "bonusesChargeTotal", "bonusesCreditTotal", "status", "vatRate", "comment",
        "ordering", "isCanceled", "createdAt",
        "offer", "priceType", "prices", "discounts", "properties", "markingObjects", updated_at)
    SELECT (el->>'id')::bigint, crm_order_id,
           nullif(el->>'quantity','')::numeric, nullif(el->>'initialPrice','')::numeric,
           nullif(el->>'purchasePrice','')::numeric, nullif(el->>'discountTotal','')::numeric,
           nullif(el->>'bonusesChargeTotal','')::numeric, nullif(el->>'bonusesCreditTotal','')::numeric,
           nullif(el->>'status',''), nullif(el->>'vatRate',''), nullif(el->>'comment',''),
           nullif(el->>'ordering','')::integer, nullif(el->>'isCanceled','')::boolean,
           nullif(el->>'createdAt','')::timestamptz,
           el->'offer', el->'priceType', el->'prices', el->'discounts',
           el->'properties', el->'markingObjects', NOW()
      FROM jsonb_array_elements(NEW.raw_payload->'items') el
     WHERE el->>'id' ~ '^[0-9]+$'
    ON CONFLICT ("id") DO UPDATE SET
        order_id = EXCLUDED.order_id,
        "quantity" = EXCLUDED."quantity",
        "initialPrice" = EXCLUDED."initialPrice",
        "purchasePrice" = EXCLUDED."purchasePrice",
        "discountTotal" = EXCLUDED."discountTotal",
        "bonusesChargeTotal" = EXCLUDED."bonusesChargeTotal",
        "bonusesCreditTotal" = EXCLUDED."bonusesCreditTotal",
        "status" = EXCLUDED."status",
        "vatRate" = EXCLUDED."vatRate",
        "comment" = EXCLUDED."comment",
        "ordering" = EXCLUDED."ordering",
        "isCanceled" = EXCLUDED."isCanceled",
        "createdAt" = EXCLUDED."createdAt",
        "offer" = EXCLUDED."offer",
        "priceType" = EXCLUDED."priceType",
        "prices" = EXCLUDED."prices",
        "discounts" = EXCLUDED."discounts",
        "properties" = EXCLUDED."properties",
        "markingObjects" = EXCLUDED."markingObjects",
        updated_at = NOW();

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'order_items_sync (заказ %): %', crm_order_id, SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS order_items_sync ON public.orders;
CREATE TRIGGER order_items_sync
    AFTER INSERT OR UPDATE OF raw_payload ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.order_items_sync();

COMMENT ON FUNCTION public.order_items_sync() IS
  'Держит order_items в соответствии с составом заказа из raw_payload';
