create or replace function upsert_orders(orders_data jsonb)
returns void
language plpgsql
security definer
as $$
begin
  insert into orders (
    id, order_id, created_at, updated_at, number, status, 
    event_type, manager_id, phone, customer_phones, totalsumm, raw_payload
  )
  select
    (x->>'id')::int8,
    (x->>'order_id')::int8,
    (x->>'created_at')::timestamptz,
    (x->>'updated_at')::timestamptz,
    x->>'number',
    x->>'status',
    x->>'event_type',
    x->>'manager_id',
    x->>'phone',
    -- Cast JSON array to Text array equivalent
    case 
        when x->>'customer_phones' is null then null 
        else array(select jsonb_array_elements_text(x->'customer_phones'))
    end,
    (x->>'totalsumm')::numeric,
    (x->>'raw_payload')::jsonb
  from jsonb_array_elements(orders_data) as x
  on conflict (id) do update
  set
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
end;
$$;

GRANT EXECUTE ON FUNCTION upsert_orders(jsonb) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload config';
