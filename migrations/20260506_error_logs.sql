-- Таблица для мониторинга ошибок (замена Sentry для самостоятельного хостинга)
CREATE TABLE IF NOT EXISTS public.error_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source      TEXT NOT NULL,           -- имя модуля / route (e.g. 'widget/chat', 'leads/catch')
    level       TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error','warn','info')),
    message     TEXT NOT NULL,
    stack       TEXT,                    -- stack trace если есть
    context     JSONB,                   -- доп. данные (ip, visitorId, body snippet и т.д.)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_source     ON public.error_logs (source);
CREATE INDEX IF NOT EXISTS idx_error_logs_level      ON public.error_logs (level);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs (created_at DESC);

-- Автоудаление записей старше 90 дней (чтобы таблица не росла бесконечно)
-- Запускается вручную или через pg_cron если подключён
-- DELETE FROM public.error_logs WHERE created_at < NOW() - INTERVAL '90 days';

-- RLS: только service_role может читать/писать (не анонимные пользователи)
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
