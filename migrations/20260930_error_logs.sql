-- Журнал ошибок, которого не было.
--
-- В коде давно есть `logError` (lib/error-monitor.ts) — он пишет в таблицу
-- `error_logs`, а её в базе нет. Запись падает, ошибка записи заглушена
-- «чтобы не ронять прод», и в итоге ошибки уходили в никуда. Нашли 30.09.2026,
-- когда владелец попросил присылать ему все ошибки.
--
-- Отсюда же их забирает сводка в Telegram (`/api/cron/error-digest`).

CREATE TABLE IF NOT EXISTS public.error_logs (
    id          BIGSERIAL PRIMARY KEY,
    source      TEXT NOT NULL,
    level       TEXT NOT NULL DEFAULT 'error',
    message     TEXT NOT NULL,
    stack       TEXT,
    context     JSONB,
    /** Когда об этой ошибке сообщили человеку. NULL — ещё не сообщали. */
    notified_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_unnotified ON public.error_logs (notified_at) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_error_logs_source ON public.error_logs (source, created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.error_logs;
CREATE POLICY "service role full access" ON public.error_logs FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.error_logs IS 'Ошибки системы: пишет logError, забирает сводка в Telegram';
