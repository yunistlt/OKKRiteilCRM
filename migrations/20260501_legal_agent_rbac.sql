-- Добавление роли legal и политик доступа для contract_reviews

-- Добавить роль legal, если требуется
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'legal';

-- RLS для contract_reviews
CREATE POLICY "Manager can view their own contract reviews"
    ON public.legal_contract_reviews FOR SELECT
    USING (can_access_order(order_id));

CREATE POLICY "Legal and Admin can view all"
    ON public.legal_contract_reviews FOR SELECT
    USING (has_full_order_access());

-- Пример granular permissions (расширяемость)
-- Можно добавить таблицу legal_permissions и связывать с profiles
-- CREATE TABLE IF NOT EXISTS public.legal_permissions (...)
