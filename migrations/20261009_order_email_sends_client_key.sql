-- Ключ письма от браузера: защита от двойной отправки.
--
-- Менеджер нажимает «Отправить» второй раз, когда первый ответ задержался, —
-- и клиент получает два одинаковых письма. Сервер по этому ключу узнаёт своё
-- уже отправленное письмо и второй раз его не шлёт.
--
-- Ключ рождается в браузере при открытии письма и живёт до успешной отправки.
-- Миграция добавочная: старые строки остаются с NULL, уникальность — только
-- там, где ключ есть.

ALTER TABLE public.order_email_sends
    ADD COLUMN IF NOT EXISTS client_key TEXT;

COMMENT ON COLUMN public.order_email_sends.client_key IS
    'Ключ письма от браузера: одно нажатие «Отправить» = одно письмо, сколько бы раз его ни повторили.';

CREATE UNIQUE INDEX IF NOT EXISTS order_email_sends_client_key_unique
    ON public.order_email_sends (client_key)
    WHERE client_key IS NOT NULL;
