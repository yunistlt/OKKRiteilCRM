-- Планы — в личку, в общий чат — короткая сводка.
--
-- Причина простая: подробный план на девять заказов это экран текста. Три таких
-- сообщения подряд превращают рабочий чат в ленту, которую пролистывают, и туда
-- же проваливаются оплаты и всё остальное, ради чего чат существует.
--
-- В общий чат остаётся то, ради чего он и нужен: кто сколько получил и кто
-- сколько отработал. Публичность дисциплины — да, публичность деталей — нет.
ALTER TABLE public.sales_rop_manager ADD COLUMN IF NOT EXISTS telegram_chat_id text;
ALTER TABLE public.sales_rop_manager ADD COLUMN IF NOT EXISTS telegram_username text;
ALTER TABLE public.sales_rop_manager ADD COLUMN IF NOT EXISTS started_at timestamptz;

COMMENT ON COLUMN public.sales_rop_manager.telegram_chat_id IS
    'Личный чат с ботом. Появляется только после того, как человек сам напишет боту: Telegram не даёт написать первым.';

INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('deliver_plans_to_dm', 'true', 'Слать планы в личку. Нет личного чата — уйдёт в общий, чтобы человек не остался без плана'),
    ('summary_to_group', 'true', 'Короткая сводка по отделу в общий чат')
ON CONFLICT (key) DO NOTHING;
