-- Маршрутизация входящего звонка на менеджера клиента.
-- Решение владельца 13.10.2026: переводим только на девочек ОП, Ларису и Катю.
-- Кто принимает перевод — настройка пофамильно, а не список в коде.
-- Аддитивно и идемпотентно.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'managers' AND column_name = 'accepts_call_transfer'
    ) THEN
        ALTER TABLE public.managers ADD COLUMN accepts_call_transfer BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

COMMENT ON COLUMN public.managers.accepts_call_transfer IS
    'Можно переводить входящий звонок на этого человека (ОП, Лариса, Катя). Проверяется вместе с active и telphin_extension';

-- Ветка by_caller в журнале секретаря: номер звонящего разобрали без вопросов к человеку.
COMMENT ON COLUMN public.secretary_calls.mode IS
    'Ветка схемы Телфина: existing (по номеру заказа) | new (новая заявка) | by_caller (узнали по АОН)';
COMMENT ON COLUMN public.secretary_calls.decision IS
    'routed_existing | routed_by_caller | created_new | not_found | no_manager | not_a_target | created_no_manager | error';

NOTIFY pgrst, 'reload config';
