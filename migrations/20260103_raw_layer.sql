-- ============================================
-- RAW LAYER: Протокол реальности
-- ============================================
-- Принцип: append-only, никаких UPDATE/DELETE
-- Каждое событие = одна строка
-- Идемпотентность через UNIQUE constraints

-- ============================================
-- 1. RAW ORDER EVENTS (из RetailCRM)
-- ============================================

CREATE TABLE IF NOT EXISTS public.raw_order_events (
    -- Внутренний ID события
    event_id BIGSERIAL PRIMARY KEY,
    
    -- Идентификация заказа (сквозной ключ)
    retailcrm_order_id INT NOT NULL,
    
    -- Тип события
    event_type TEXT NOT NULL, -- 'order_created', 'status_changed', 'comment_added', 'phone_changed', etc.
    
    -- Когда произошло в реальности
    occurred_at TIMESTAMPTZ NOT NULL,
    
    -- Источник данных
    source TEXT DEFAULT 'retailcrm' NOT NULL,
    
    -- Полный payload события (immutable)
    raw_payload JSONB NOT NULL,
    
    -- Метаданные загрузки
    ingested_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Идемпотентность: одно и то же событие не дублируется
    CONSTRAINT unique_order_event UNIQUE(retailcrm_order_id, event_type, occurred_at, source)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_raw_order_events_order_id ON public.raw_order_events(retailcrm_order_id);
CREATE INDEX IF NOT EXISTS idx_raw_order_events_occurred_at ON public.raw_order_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_order_events_event_type ON public.raw_order_events(event_type);
CREATE INDEX IF NOT EXISTS idx_raw_order_events_ingested_at ON public.raw_order_events(ingested_at DESC);

-- Комментарии
COMMENT ON TABLE public.raw_order_events IS 'RAW-слой: все события из RetailCRM (append-only, immutable)';
COMMENT ON COLUMN public.raw_order_events.event_type IS 'Тип события: order_created, status_changed, comment_added, phone_changed, etc.';
COMMENT ON COLUMN public.raw_order_events.occurred_at IS 'Когда событие произошло в реальности (из RetailCRM)';
COMMENT ON COLUMN public.raw_order_events.raw_payload IS 'Полный JSON payload события (никогда не меняется)';

-- ============================================
-- 2. RAW TELPHIN CALLS (из Telphin)
-- ============================================

CREATE TABLE IF NOT EXISTS public.raw_telphin_calls (
    -- Внутренний ID события
    event_id BIGSERIAL PRIMARY KEY,
    
    -- ID звонка из Telphin (сквозной ключ)
    telphin_call_id TEXT NOT NULL UNIQUE,
    
    -- Направление звонка
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    
    -- Номера (как есть из Telphin)
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    
    -- Нормализованные номера (для матчинга)
    from_number_normalized TEXT,
    to_number_normalized TEXT,
    
    -- Время начала звонка
    started_at TIMESTAMPTZ NOT NULL,
    
    -- Длительность (секунды)
    duration_sec INT,
    
    -- Ссылка на запись
    recording_url TEXT,
    
    -- Полный payload от Telphin (immutable)
    raw_payload JSONB NOT NULL,
    
    -- Метаданные загрузки
    ingested_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_started_at ON public.raw_telphin_calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_from_normalized ON public.raw_telphin_calls(from_number_normalized);
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_to_normalized ON public.raw_telphin_calls(to_number_normalized);
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_direction ON public.raw_telphin_calls(direction);
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_ingested_at ON public.raw_telphin_calls(ingested_at DESC);

-- Комментарии
COMMENT ON TABLE public.raw_telphin_calls IS 'RAW-слой: все звонки из Telphin (append-only, immutable)';
COMMENT ON COLUMN public.raw_telphin_calls.telphin_call_id IS 'Уникальный ID звонка из Telphin';
COMMENT ON COLUMN public.raw_telphin_calls.from_number_normalized IS 'Нормализованный номер (только цифры) для матчинга';
COMMENT ON COLUMN public.raw_telphin_calls.raw_payload IS 'Полный JSON payload от Telphin (никогда не меняется)';

-- ============================================
-- RLS (Row Level Security)
-- ============================================

ALTER TABLE public.raw_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_telphin_calls ENABLE ROW LEVEL SECURITY;

-- Политики доступа
CREATE POLICY "Allow all for service role" ON public.raw_order_events
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for service role" ON public.raw_telphin_calls
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Права доступа
-- ============================================

GRANT SELECT, INSERT ON public.raw_order_events TO service_role, anon, authenticated;
GRANT SELECT, INSERT ON public.raw_telphin_calls TO service_role, anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.raw_order_events_event_id_seq TO service_role, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.raw_telphin_calls_event_id_seq TO service_role, anon, authenticated;

-- ============================================
-- ВАЖНО: Запрет на UPDATE/DELETE
-- ============================================
-- В production добавить триггеры, запрещающие UPDATE/DELETE
-- Или использовать RLS-политики для ограничения

COMMENT ON TABLE public.raw_order_events IS 
'RAW-слой: APPEND-ONLY. UPDATE/DELETE ЗАПРЕЩЕНЫ. Каждое событие = immutable факт.';

COMMENT ON TABLE public.raw_telphin_calls IS 
'RAW-слой: APPEND-ONLY. UPDATE/DELETE ЗАПРЕЩЕНЫ. Каждый звонок = immutable факт.';
