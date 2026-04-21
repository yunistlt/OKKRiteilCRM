-- Миграция для модуля ИИ-Юрисконсульт (legal_agent)

-- 1. Кэш проверок по ИНН
CREATE TABLE IF NOT EXISTS public.legal_counterparties_cache (
    id BIGSERIAL PRIMARY KEY,
    inn VARCHAR(12) NOT NULL,
    data JSONB NOT NULL,
    risk_score VARCHAR(16),
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES public.profiles(id),
    -- TTL: автоматическое удаление через 30 дней
    expires_at TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS (checked_at + INTERVAL '30 days') STORED
);
CREATE INDEX IF NOT EXISTS idx_legal_counterparties_cache_inn ON public.legal_counterparties_cache(inn);
CREATE INDEX IF NOT EXISTS idx_legal_counterparties_cache_expires_at ON public.legal_counterparties_cache(expires_at);

-- 2. Журнал проверенных договоров
CREATE TABLE IF NOT EXISTS public.legal_contract_reviews (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL,
    file_url TEXT NOT NULL,
    risk_score VARCHAR(16),
    extracted_data JSONB,
    original_file_url TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_legal_contract_reviews_order_id ON public.legal_contract_reviews(order_id);

-- 3. Чаты Legal-Consultant (переиспользуем структуру мессенджера)
CREATE TABLE IF NOT EXISTS public.legal_consultant_threads (
    id BIGSERIAL PRIMARY KEY,
    agent_type VARCHAR(32) DEFAULT 'alexander',
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.legal_consultant_messages (
    id BIGSERIAL PRIMARY KEY,
    thread_id BIGINT REFERENCES public.legal_consultant_threads(id) ON DELETE CASCADE,
    sender_role VARCHAR(32),
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Аудит действий (минимальный)
CREATE TABLE IF NOT EXISTS public.legal_audit_log (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64),
    entity_id BIGINT,
    performed_by UUID REFERENCES public.profiles(id),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    details JSONB
);
