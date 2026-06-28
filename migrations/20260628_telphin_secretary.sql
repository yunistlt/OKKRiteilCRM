-- Migration: голосовой AI-секретарь Телфина
-- 1) Добавочный (внутренний номер) Телфина на менеджера — для перевода звонка
-- 2) Лог звонков секретаря (вход, решение, исход)
-- Аддитивно и идемпотентно.

-- 1. managers.telphin_extension
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'managers' AND column_name = 'telphin_extension'
    ) THEN
        ALTER TABLE public.managers ADD COLUMN telphin_extension TEXT;
    END IF;
END $$;

COMMENT ON COLUMN public.managers.telphin_extension IS 'Внутренний номер (добавочный) менеджера в Телфине для перевода звонка AI-секретарём';

-- 2. secretary_calls — журнал обращений к AI-секретарю
CREATE TABLE IF NOT EXISTS public.secretary_calls (
    id            BIGSERIAL PRIMARY KEY,
    call_id       TEXT,                 -- CallID из Телфина (идемпотентность/связка)
    caller        TEXT,                 -- CallerIDNum (номер звонящего)
    mode          TEXT,                 -- 'existing' | 'new'
    dtmf          TEXT,                 -- voice_navigator_DTMF (набранный номер заказа)
    stt           TEXT,                 -- voice_navigator_STT (распознанная речь)
    decision      TEXT,                 -- routed_existing | created_new | not_found | no_manager | created_no_manager | error
    order_number  TEXT,
    order_id      BIGINT,
    manager_id    BIGINT,
    extension     TEXT,                 -- куда перевели
    raw           JSONB,                -- все полученные параметры запроса
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secretary_calls_created_at ON public.secretary_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_secretary_calls_call_id ON public.secretary_calls (call_id);
CREATE INDEX IF NOT EXISTS idx_secretary_calls_caller ON public.secretary_calls (caller);

ALTER TABLE public.secretary_calls ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'secretary_calls' AND policyname = 'Allow service access'
    ) THEN
        CREATE POLICY "Allow service access" ON public.secretary_calls USING (true) WITH CHECK (true);
    END IF;
END $$;
GRANT ALL ON public.secretary_calls TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.secretary_calls_id_seq TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload config';
