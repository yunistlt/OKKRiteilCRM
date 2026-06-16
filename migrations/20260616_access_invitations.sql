-- Ссылки-приглашения для создания аккаунтов с заранее заданной ролью и правами.
-- Получатель открывает ссылку, задаёт логин и пароль — создаётся локальный аккаунт
-- с ролью из приглашения (а значит и со всеми бизнес-правами этой роли).
-- Ссылка многоразовая: работает, пока администратор её не отзовёт (revoked = true).

CREATE TABLE IF NOT EXISTS public.access_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    role public.app_role NOT NULL,
    retail_crm_manager_id BIGINT,
    first_name TEXT,
    last_name TEXT,
    note TEXT,
    revoked BOOLEAN NOT NULL DEFAULT false,
    used_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_invitations_token ON public.access_invitations (token);
CREATE INDEX IF NOT EXISTS idx_access_invitations_active ON public.access_invitations (revoked, created_at DESC);
