-- Доступ Тамары к Google Calendar: ритм планёрок.
--
-- Права запрошены двумя узкими вместо одного широкого:
--   calendar.app.created — Штаб заводит СВОЙ календарь «Ритм Штаба» и пишет
--     только в него; личные события владельца недоступны ни на запись, ни на
--     чтение, и это ограничение Google, а не наша дисциплина;
--   calendar.freebusy   — видна занятость без содержания встреч.
--
-- Refresh-токен не истекает сам и даёт доступ до отзыва, поэтому хранится
-- зашифрованным (AES-256-GCM, ключ SHTAB_TOKEN_KEY из окружения). Доступ к базе
-- шире, чем к календарю: сервисная роль читает все таблицы, и шифрование сужает
-- это обратно.
--
-- Строка ровно одна: календарь у Штаба один, как и владелец. Отсюда id = 1 и
-- ограничение, которое не даст завести вторую.

CREATE TABLE IF NOT EXISTS public.shtab_google_token (
    id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    account_email text NOT NULL,
    -- оба токена лежат зашифрованными; в открытом виде их здесь не бывает
    access_token  text NOT NULL,
    refresh_token text NOT NULL,
    expires_at    timestamptz NOT NULL,
    scope         text NOT NULL DEFAULT '',
    -- календарь «Ритм Штаба», созданный самим Штабом
    calendar_id   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shtab_google_token IS
    'Доступ к Google Calendar для ритма планёрок. Токены зашифрованы ключом SHTAB_TOKEN_KEY.';

ALTER TABLE public.shtab_google_token ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shtab_google_token_service_role ON public.shtab_google_token;
CREATE POLICY shtab_google_token_service_role
    ON public.shtab_google_token FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.shtab_google_token TO postgres, service_role;
