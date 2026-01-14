-- Fix missing Foreign Key for Violations -> Orders to allow joining
-- 1. Optional: Clean up orphan violations (violations pointing to non-existent orders)
-- This ensures the FK constraint can be applied successfully.
DELETE FROM public.okk_violations
WHERE order_id IS NOT NULL
  AND order_id NOT IN (SELECT id FROM public.orders);

-- 2. Add the Foreign Key Constraint
ALTER TABLE public.okk_violations
ADD CONSTRAINT fk_violations_orders
FOREIGN KEY (order_id)
REFERENCES public.orders (id)
ON DELETE SET NULL;

COMMENT ON CONSTRAINT fk_violations_orders ON public.okk_violations IS 
'Enables joining violations with orders to see status and sum.';
