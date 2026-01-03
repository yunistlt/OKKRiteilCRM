-- ============================================
-- УЛУЧШЕНИЕ МАТЧИНГА: Денормализация и индексы
-- ============================================

-- 1. Добавляем денормализованные поля для быстрого поиска
ALTER TABLE public.raw_order_events 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
ADD COLUMN IF NOT EXISTS additional_phone TEXT,
ADD COLUMN IF NOT EXISTS additional_phone_normalized TEXT,
ADD COLUMN IF NOT EXISTS manager_id INT;

-- 2. Заполняем из raw_payload
UPDATE public.raw_order_events
SET 
    phone = raw_payload->>'phone',
    phone_normalized = regexp_replace(COALESCE(raw_payload->>'phone', ''), '[^\d+]', '', 'g'),
    additional_phone = raw_payload->>'additional_phone',
    additional_phone_normalized = regexp_replace(COALESCE(raw_payload->>'additional_phone', ''), '[^\d+]', '', 'g'),
    manager_id = (raw_payload->>'manager_id')::INT
WHERE phone IS NULL;

-- 3. Создаём индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_raw_order_events_phone_norm 
ON public.raw_order_events(phone_normalized) 
WHERE phone_normalized IS NOT NULL AND phone_normalized != '';

CREATE INDEX IF NOT EXISTS idx_raw_order_events_additional_phone_norm 
ON public.raw_order_events(additional_phone_normalized) 
WHERE additional_phone_normalized IS NOT NULL AND additional_phone_normalized != '';

-- Индекс для поиска по последним 7 цифрам (частичное совпадение)
CREATE INDEX IF NOT EXISTS idx_raw_order_events_phone_suffix 
ON public.raw_order_events(RIGHT(phone_normalized, 7)) 
WHERE phone_normalized IS NOT NULL AND LENGTH(phone_normalized) >= 7;

CREATE INDEX IF NOT EXISTS idx_raw_order_events_additional_phone_suffix 
ON public.raw_order_events(RIGHT(additional_phone_normalized, 7)) 
WHERE additional_phone_normalized IS NOT NULL AND LENGTH(additional_phone_normalized) >= 7;

-- 4. GIN индекс для полнотекстового поиска по payload (опционально)
CREATE INDEX IF NOT EXISTS idx_raw_order_events_payload_gin 
ON public.raw_order_events USING GIN (raw_payload);

-- 5. Комментарии
COMMENT ON COLUMN public.raw_order_events.phone_normalized IS 'Нормализованный номер телефона (только цифры и +) для быстрого матчинга';
COMMENT ON COLUMN public.raw_order_events.additional_phone_normalized IS 'Нормализованный дополнительный номер для быстрого матчинга';
