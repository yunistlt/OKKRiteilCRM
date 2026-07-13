-- Проект платежа: 'zmktl' | 'stolyarka' | 'consulting' | NULL (не определён/пропущен).
-- Для вкладок по проектам на /payments. Аддитивно.
ALTER TABLE public.point_payments
    ADD COLUMN IF NOT EXISTS project text;
