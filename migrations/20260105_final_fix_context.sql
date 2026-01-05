
-- 1. Backfill existing data
UPDATE public.order_metrics om
SET full_order_context = jsonb_build_object(
    'manager_comment', o.raw_payload->>'managerComment',
    'status_name', o.raw_payload->'status'->>'name',
    'items_count', jsonb_array_length(o.raw_payload->'items'),
    'site', o.raw_payload->>'site'
)
FROM public.orders o
WHERE om.retailcrm_order_id = o.order_id
AND (om.full_order_context IS NULL OR om.full_order_context = '{}'::jsonb);

-- 2. Update RPC to keep it updated in the future (re-defining upsert_orders_v2)
CREATE OR REPLACE FUNCTION public.upsert_orders_v2(orders_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $$
BEGIN
    -- 1. Upsert into orders table
    INSERT INTO public.orders (
        id, 
        order_id, 
        created_at, 
        updated_at, 
        number, 
        status, 
        event_type, 
        manager_id, 
        phone, 
        customer_phones, 
        totalsumm, 
        raw_payload
    )
    SELECT 
        (val->>'id')::bigint,
        (val->>'order_id')::bigint,
        (val->>'created_at')::timestamptz,
        (val->>'updated_at')::timestamptz,
        (val->>'number'),
        (val->>'status'),
        (val->>'event_type'),
        (val->>'manager_id'),
        (val->>'phone'),
        (val->'customer_phones')::jsonb,
        (val->>'totalsumm')::numeric,
        (val->'raw_payload')::jsonb
    FROM jsonb_array_elements(orders_data) AS val
    ON CONFLICT (id) DO UPDATE SET
        updated_at = EXCLUDED.updated_at,
        status = EXCLUDED.status,
        manager_id = EXCLUDED.manager_id,
        raw_payload = EXCLUDED.raw_payload,
        totalsumm = EXCLUDED.totalsumm;

    -- 2. Update order_metrics table with context
    INSERT INTO public.order_metrics (
        retailcrm_order_id,
        current_status,
        manager_id,
        order_amount,
        full_order_context,
        computed_at
    )
    SELECT 
        (val->>'order_id')::int,
        (val->>'status'),
        (val->>'manager_id')::int,
        (val->>'totalsumm')::numeric,
        jsonb_build_object(
            'manager_comment', (val->'raw_payload'->>'managerComment'),
            'status_name', (val->'raw_payload'->'status'->>'name'),
            'site', (val->'raw_payload'->>'site')
        ),
        now()
    FROM jsonb_array_elements(orders_data) AS val
    ON CONFLICT (retailcrm_order_id) DO UPDATE SET
        current_status = EXCLUDED.current_status,
        manager_id = EXCLUDED.manager_id,
        order_amount = EXCLUDED.order_amount,
        full_order_context = EXCLUDED.full_order_context,
        computed_at = now();
END;
$$;
