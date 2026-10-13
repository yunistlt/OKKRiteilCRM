-- ============================================================================
-- Недостающие поля заказа: оплаты и «Отдать БОТУ».
--
-- Закон владельца 06.10.2026: «у каждого значения должно быть поле; снимок —
-- это запись истории, по нему видно, каким значение было раньше, но источником
-- истины он не является»; «не надо ничего выдумывать — взять все поля, которые
-- были в ритейле, и сделать у себя то же самое, без костылей».
--
-- Сверка с RetailCRM показала: из 66 дополнительных полей заказа колонки есть
-- у 65 (одно имя Postgres укоротил до 63 знаков — оно на месте). Не хватало
-- `otdat_botu`. И не было места для оплат: они лежали только внутри снимка, у
-- 30 098 заказов.
--
-- Оплаты кладём отдельной таблицей, как и позиции заказа: их у заказа
-- несколько, колонкой не выразить. Поля — ровно те, что отдаёт RetailCRM:
-- id, type, status, amount, paidAt, comment, externalId.
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS otdat_botu boolean;

COMMENT ON COLUMN public.orders.otdat_botu IS
    'Дополнительное поле заказа RetailCRM «Отдать БОТУ».';

CREATE TABLE IF NOT EXISTS public.order_payments (
    id           bigint PRIMARY KEY,
    order_id     bigint NOT NULL,
    "type"       text,
    "status"     text,
    amount       numeric,
    "paidAt"     timestamptz,
    "comment"    text,
    "externalId" text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_payments_order ON public.order_payments(order_id);

COMMENT ON TABLE public.order_payments IS
    'Оплаты заказа — своё место, как и позиции (закон «у каждого значения своё поле», 06.10.2026). Раньше лежали только внутри снимка.';

-- ============================================================================
-- Раскладка оплат из заказа — тем же способом, что и позиции (order_items_sync).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.order_payments_sync()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    crm_order_id BIGINT := COALESCE(NEW.order_id, NEW.id);
BEGIN
    IF NEW.raw_payload IS NULL OR jsonb_typeof(NEW.raw_payload->'payments') <> 'object' THEN
        RETURN NULL;
    END IF;

    -- Оплаты, которых в заказе больше нет.
    DELETE FROM public.order_payments op
     WHERE op.order_id = crm_order_id
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(NEW.raw_payload->'payments') el
            WHERE (el.value->>'id')::bigint = op.id
       );

    INSERT INTO public.order_payments (id, order_id, "type", "status", amount, "paidAt", "comment", "externalId", updated_at)
    SELECT (el.value->>'id')::bigint, crm_order_id,
           nullif(el.value->>'type',''), nullif(el.value->>'status',''),
           nullif(el.value->>'amount','')::numeric,
           nullif(el.value->>'paidAt','')::timestamptz,
           nullif(el.value->>'comment',''), nullif(el.value->>'externalId',''),
           NOW()
      FROM jsonb_each(NEW.raw_payload->'payments') el
     WHERE el.value->>'id' ~ '^[0-9]+$'
    ON CONFLICT (id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        "type" = EXCLUDED."type",
        "status" = EXCLUDED."status",
        amount = EXCLUDED.amount,
        "paidAt" = EXCLUDED."paidAt",
        "comment" = EXCLUDED."comment",
        "externalId" = EXCLUDED."externalId",
        updated_at = NOW();

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'order_payments_sync (заказ %): %', crm_order_id, SQLERRM;
    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS order_payments_sync ON public.orders;
CREATE TRIGGER order_payments_sync
    AFTER INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.order_payments_sync();

-- «Отдать БОТУ» заполняем из заказа тем же триггером, что и остальные колонки.
UPDATE public.orders
   SET otdat_botu = (raw_payload->'customFields'->>'otdat_botu')::boolean
 WHERE otdat_botu IS NULL
   AND raw_payload->'customFields'->>'otdat_botu' IN ('true', 'false');
