-- Телеграм-адрес менеджера своей колонкой.
--
-- Ник и chat_id лежали в `managers.raw_data` — объекте, который синхронизация
-- перезаписывает данными из RetailCRM. Ник она сохраняет особым случаем, а
-- chat_id Ларисы (13) затёрся в тот же день, когда был записан (05.10.2026).
-- Свои данные должны лежать в своих колонках.
ALTER TABLE public.managers
    ADD COLUMN IF NOT EXISTS telegram_chat_id text,
    ADD COLUMN IF NOT EXISTS telegram_username text;

COMMENT ON COLUMN public.managers.telegram_chat_id IS
    'Личный чат с ботом ОКК; появляется после того, как человек написал боту';

-- Переносим то, что уже есть в raw_data, чтобы ничего не потерять.
UPDATE public.managers
SET telegram_username = COALESCE(telegram_username, raw_data->>'telegram_username'),
    telegram_chat_id = COALESCE(telegram_chat_id, raw_data->>'telegram_chat_id')
WHERE raw_data ? 'telegram_username' OR raw_data ? 'telegram_chat_id';
