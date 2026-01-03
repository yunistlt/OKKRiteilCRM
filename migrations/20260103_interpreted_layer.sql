-- ============================================
-- INTERPRETED LAYER: Текущая картина
-- ============================================
-- Принцип: UPDATE разрешён (пересчёт)
-- Детерминированный пересчёт из RAW
-- Без истории (только текущее состояние)

-- ============================================
-- 1. CALL-ORDER MATCHES (с confidence)
-- ============================================

CREATE TABLE IF NOT EXISTS public.call_order_matches (
    -- Внутренний ID связи
    match_id BIGSERIAL PRIMARY KEY,
    
    -- Связь звонка с заказом
    telphin_call_id TEXT NOT NULL,
    retailcrm_order_id INT NOT NULL,
    
    -- Тип матчинга
    match_type TEXT NOT NULL CHECK (match_type IN (
        'by_phone_time',      -- Точное совпадение номера + временное окно
        'by_phone_manager',   -- Совпадение номера + менеджер
        'by_partial_phone',   -- Частичное совпадение номера
        'manual'              -- Ручная привязка
    )),
    
    -- Уверенность в связи (0.00 - 1.00)
    confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
    
    -- Когда установлена связь
    matched_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Правило, которое установило связь
    rule_id TEXT,
    
    -- Человекочитаемое объяснение
    explanation TEXT NOT NULL,
    
    -- Факторы матчинга (для explainability)
    matching_factors JSONB,
    
    -- Уникальность: один звонок может быть привязан к нескольким заказам (с разным confidence)
    CONSTRAINT unique_call_order_match UNIQUE(telphin_call_id, retailcrm_order_id)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_call_matches_call_id ON public.call_order_matches(telphin_call_id);
CREATE INDEX IF NOT EXISTS idx_call_matches_order_id ON public.call_order_matches(retailcrm_order_id);
CREATE INDEX IF NOT EXISTS idx_call_matches_confidence ON public.call_order_matches(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_call_matches_type ON public.call_order_matches(match_type);

-- Комментарии
COMMENT ON TABLE public.call_order_matches IS 'INTERPRETED: гипотезы связи звонков с заказами (с confidence и объяснением)';
COMMENT ON COLUMN public.call_order_matches.confidence_score IS 'Уверенность в связи: 0.95+ = автоматически в метриках, 0.70-0.94 = с пометкой, <0.70 = не использовать';
COMMENT ON COLUMN public.call_order_matches.explanation IS 'Человекочитаемое объяснение: "Совпадение телефона, звонок через 240 сек после события"';
COMMENT ON COLUMN public.call_order_matches.matching_factors IS 'JSON с факторами: {phone_match: true, time_diff_sec: 240, manager_match: false}';

-- ============================================
-- 2. ORDER METRICS (вычисляемые показатели)
-- ============================================

CREATE TABLE IF NOT EXISTS public.order_metrics (
    -- Связь с заказом (1:1)
    retailcrm_order_id INT PRIMARY KEY,
    
    -- Текущий статус
    current_status TEXT,
    status_changed_at TIMESTAMPTZ,
    
    -- Контакты
    last_contact_at TIMESTAMPTZ,
    days_without_contact NUMERIC,
    total_calls_count INT DEFAULT 0,
    real_calls_count INT DEFAULT 0, -- Только с confidence >= 0.70
    
    -- Финансы
    order_amount NUMERIC,
    
    -- SLA
    sla_hours NUMERIC,
    is_sla_breached BOOLEAN DEFAULT false,
    
    -- Менеджер
    manager_id INT,
    
    -- Метаданные пересчёта
    computed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    computed_from_events_count INT DEFAULT 0
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_order_metrics_status ON public.order_metrics(current_status);
CREATE INDEX IF NOT EXISTS idx_order_metrics_manager ON public.order_metrics(manager_id);
CREATE INDEX IF NOT EXISTS idx_order_metrics_last_contact ON public.order_metrics(last_contact_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_metrics_sla_breach ON public.order_metrics(is_sla_breached) WHERE is_sla_breached = true;

-- Комментарии
COMMENT ON TABLE public.order_metrics IS 'INTERPRETED: вычисляемые показатели заказов (UPDATE разрешён, пересчёт из RAW)';
COMMENT ON COLUMN public.order_metrics.real_calls_count IS 'Только звонки с confidence_score >= 0.70';
COMMENT ON COLUMN public.order_metrics.computed_at IS 'Когда последний раз пересчитывались метрики';

-- ============================================
-- 3. ORDERS (только идентификация)
-- ============================================

-- Обновляем существующую таблицу orders
-- Добавляем комментарий о новой роли
COMMENT ON TABLE public.orders IS 'INTERPRETED: узел идентификации заказов (retailcrm_order_id = сквозной ключ)';

-- ============================================
-- RLS (Row Level Security)
-- ============================================

ALTER TABLE public.call_order_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON public.call_order_matches
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for service role" ON public.order_metrics
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Права доступа
-- ============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_order_matches TO service_role, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_metrics TO service_role, anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.call_order_matches_match_id_seq TO service_role, anon, authenticated;
