-- ============================================================================
-- Оплаты, внесённые у нас, больше не затираются переносом.
--
-- Повод 06.10.2026: по заказам 54789 и 54863 (ЗАО «Тюменьагромаш») деньги
-- пришли — 887 234,78 ₽ двумя платежами, они видны в ЦехУспехе, — но в ОКК их
-- нет: банковский обмен эти поступления не получал, похоже, они пришли в банк,
-- с которым обмена нет. Заказы при этом ушли в производство, и показатель
-- предоплаты у Елены Парфёновой упал до 63 %.
--
-- Внести такие оплаты было некуда: `order_payments` целиком пересобирается из
-- снимка заказа, и всё, что добавлено руками, удалялось бы при первом же его
-- обновлении.
--
-- Теперь у строки есть источник: 'crm' — пришла из снимка RetailCRM, 'okk' —
-- внесена у нас. Пересборка трогает только 'crm'.
-- ============================================================================

ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'crm';
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS created_by text;

COMMENT ON COLUMN public.order_payments.source IS
    'Откуда оплата: crm — из снимка RetailCRM (пересобирается), okk — внесена у нас (не трогаем).';

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

    -- Удаляем только то, что пришло из снимка: оплаты, внесённые у нас, он не
    -- знает, и стирать их нельзя.
    DELETE FROM public.order_payments op
     WHERE op.order_id = crm_order_id
       AND op.source = 'crm'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(NEW.raw_payload->'payments') el
            WHERE (el.value->>'id')::bigint = op.id
       );

    INSERT INTO public.order_payments (id, order_id, "type", "status", amount, "paidAt", "comment", "externalId", source, updated_at)
    SELECT (el.value->>'id')::bigint, crm_order_id,
           nullif(el.value->>'type',''), nullif(el.value->>'status',''),
           nullif(el.value->>'amount','')::numeric,
           nullif(el.value->>'paidAt','')::timestamptz,
           nullif(el.value->>'comment',''), nullif(el.value->>'externalId',''),
           'crm', NOW()
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
        updated_at = NOW()
     WHERE public.order_payments.source = 'crm';

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'order_payments_sync (заказ %): %', crm_order_id, SQLERRM;
    RETURN NULL;
END;
$function$;
