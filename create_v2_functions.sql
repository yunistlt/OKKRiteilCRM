-- CACHE BUSTER V2 (Создаем новые функции с суффиксом _v2)

-- 1. Orders V2
CREATE OR REPLACE FUNCTION upsert_orders_v2(orders_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO orders (
    id, order_id, created_at, updated_at, number, status, 
    event_type, manager_id, phone, customer_phones, totalsumm, raw_payload
  )
  SELECT
    (x->>'id')::bigint,
    (x->>'order_id')::bigint,
    (x->>'created_at')::timestamptz,
    (x->>'updated_at')::timestamptz,
    x->>'number',
    x->>'status',
    x->>'event_type',
    x->>'manager_id',
    x->>'phone',
    CASE 
        WHEN x->>'customer_phones' IS NULL THEN NULL 
        ELSE ARRAY(SELECT jsonb_array_elements_text(x->'customer_phones'))
    END,
    (x->>'totalsumm')::numeric,
    (x->>'raw_payload')::jsonb
  FROM jsonb_array_elements(orders_data) AS x
  ON CONFLICT (id) DO UPDATE
  SET
    order_id = excluded.order_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    number = excluded.number,
    status = excluded.status,
    event_type = excluded.event_type,
    manager_id = excluded.manager_id,
    phone = excluded.phone,
    customer_phones = excluded.customer_phones,
    totalsumm = excluded.totalsumm,
    raw_payload = excluded.raw_payload;
END;
$$;

-- 2. Managers V2
CREATE OR REPLACE FUNCTION upsert_managers_v2(managers_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO managers (id, first_name, last_name, email, active, raw_data)
  SELECT
    (x->>'id')::bigint,
    x->>'first_name',
    x->>'last_name',
    x->>'email',
    (x->>'active')::boolean,
    (x->>'raw_data')::jsonb
  FROM jsonb_array_elements(managers_data) AS x
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    active = excluded.active,
    raw_data = excluded.raw_data;
END;
$$;

-- 3. ПРАВА (Strictly for v2)
GRANT EXECUTE ON FUNCTION upsert_orders_v2(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION upsert_managers_v2(jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload config';
