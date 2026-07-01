-- Системные алерты для постоянной плашки вверху интерфейса (как «шапка-предупреждение» в RetailCRM).
-- Пишутся сервером (service_role), читаются в общий layout. Первый кейс — исчерпан баланс OpenAI:
-- ИИ-функции (разбор почты Катериной, консультанты) не работают, пока не пополнят баланс.
CREATE TABLE IF NOT EXISTS public.system_alerts (
    key TEXT PRIMARY KEY,                       -- напр. 'openai_quota'
    active BOOLEAN NOT NULL DEFAULT false,
    message TEXT,                               -- текст плашки (на русском)
    severity TEXT NOT NULL DEFAULT 'error',     -- error | warning | info
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_alerts_service_role ON public.system_alerts;
CREATE POLICY system_alerts_service_role
    ON public.system_alerts FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
