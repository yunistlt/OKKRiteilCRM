-- Обновляем ограничение (constraint) для типов матчинга, 
-- чтобы разрешить новые типы 'by_phone_day' и 'by_phone_any'.

ALTER TABLE public.call_order_matches 
DROP CONSTRAINT IF EXISTS call_order_matches_match_type_check;

ALTER TABLE public.call_order_matches 
ADD CONSTRAINT call_order_matches_match_type_check 
CHECK (match_type IN (
    'by_phone_time', 
    'by_phone_manager', 
    'by_partial_phone', 
    'manual', 
    'by_phone_day', -- Новый тип (до 12 часов)
    'by_phone_any'  -- Новый тип (более 12 часов)
));
