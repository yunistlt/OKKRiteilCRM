-- Восстановление пароля по почте.
-- 1) У legacy-аккаунтов (public.users) не было колонки email — без неё некуда слать ссылку сброса.
-- 2) Таблица одноразовых токенов сброса (по образцу access_invitations).

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS email TEXT;

-- Уникальность email без учёта регистра (только среди заполненных).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
    ON public.users (lower(email))
    WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    -- ссылка на аккаунт без жёсткого FK: аккаунт может жить и в public.users, и в public.profiles
    user_id UUID NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('users', 'profile')),
    email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
    ON public.password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
    ON public.password_reset_tokens (expires_at);

-- Доступ только service_role (как у остальных служебных таблиц).
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS password_reset_tokens_service_role ON public.password_reset_tokens;
CREATE POLICY password_reset_tokens_service_role
    ON public.password_reset_tokens
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
