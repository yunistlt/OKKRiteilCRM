-- Пересборка связи «клиент — контактное лицо» из заказов.
-- Вынесена в функцию, чтобы её мог звать крон, а не только скрипт.

CREATE OR REPLACE FUNCTION public.refresh_client_contacts()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    touched integer;
BEGIN
    INSERT INTO public.client_contacts (client_id, contact_id, orders_count, last_order_at, updated_at)
    SELECT ("customer"->>'id')::bigint, ("contact"->>'id')::bigint, count(*)::int, max("createdAt"), NOW()
      FROM public.orders
     WHERE "customer"->>'id' ~ '^[0-9]+$'
       AND "contact"->>'id' ~ '^[0-9]+$'
       AND "customer"->>'id' <> "contact"->>'id'
     GROUP BY 1, 2
    ON CONFLICT (client_id, contact_id) DO UPDATE
       SET orders_count = EXCLUDED.orders_count,
           last_order_at = EXCLUDED.last_order_at,
           updated_at = NOW();

    GET DIAGNOSTICS touched = ROW_COUNT;
    RETURN touched;
END;
$$;

COMMENT ON FUNCTION public.refresh_client_contacts() IS
  'Пересобирает client_contacts по заказам: кто из контактов относится к какому клиенту';
