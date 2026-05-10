-- Update has_full_order_access function to grant the 'demo' role full read access to quality control orders under Row Level Security.
CREATE OR REPLACE FUNCTION public.has_full_order_access()
RETURNS boolean AS $$
    SELECT public.jwt_role() IN ('admin', 'okk', 'rop', 'demo')
$$ LANGUAGE sql SECURITY DEFINER;
