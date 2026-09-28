-- Запись разговоров с Семёном: чем он отвечал и чем пользовался.
--
-- Хранилище уже было (okk_consultant_logs) и экран просмотра тоже («Аудит Семёна»),
-- но писал туда только веб-чат и только когда у разговора была ветка, а личка в
-- Telegram не писала вообще. Судить об уме агента было не по чему.
--
-- Правки добавочные: старые строки остаются валидными, новые колонки пустые.

ALTER TABLE public.okk_consultant_logs
    ADD COLUMN IF NOT EXISTS channel TEXT,              -- web | telegram
    ADD COLUMN IF NOT EXISTS model TEXT,                -- какой моделью отвечал
    ADD COLUMN IF NOT EXISTS tools JSONB,               -- какие инструменты вызвал и сколько раз
    ADD COLUMN IF NOT EXISTS answer TEXT,               -- ответ целиком; answer_preview остаётся для старых строк
    ADD COLUMN IF NOT EXISTS prompt_tokens INT,
    ADD COLUMN IF NOT EXISTS completion_tokens INT,
    ADD COLUMN IF NOT EXISTS latency_ms INT,
    ADD COLUMN IF NOT EXISTS manager_id BIGINT;         -- для лички: от чьего имени шёл разговор

CREATE INDEX IF NOT EXISTS idx_okk_consultant_logs_created
    ON public.okk_consultant_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_okk_consultant_logs_channel
    ON public.okk_consultant_logs(channel, created_at DESC);

-- Поля, обязательные для веб-чата, в личке Telegram взять неоткуда: там нет ни ветки
-- разговора, ни учётной записи в системе — собеседник опознаётся по менеджеру.
-- Пока они обязательны, запись из лички падает, а разговор теряется.
ALTER TABLE public.okk_consultant_logs ALTER COLUMN thread_id DROP NOT NULL;
ALTER TABLE public.okk_consultant_logs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.okk_consultant_logs ALTER COLUMN username DROP NOT NULL;

COMMENT ON COLUMN public.okk_consultant_logs.channel IS 'Где шёл разговор: web — панель в интерфейсе, telegram — личка';
COMMENT ON COLUMN public.okk_consultant_logs.tools IS 'Инструменты, которыми агент пользовался, отвечая на этот вопрос';
COMMENT ON COLUMN public.okk_consultant_logs.answer IS 'Ответ целиком; answer_preview оставлен ради старых строк';
