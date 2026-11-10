-- Коннектор Claude к ОКК (MCP, адрес /mcp/okk). Фаза 1 — только чтение.
--
-- Три таблицы: ключи сотрудников, журнал вызовов и реестр разделов. Сами данные
-- коннектор читает существующей функцией shtab_run_readonly_query (транзакция
-- без права записи, таймаут) и обычными выборками — новых путей к данным здесь
-- не заводится.

-- ── ключи ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_keys (
    id              bigserial PRIMARY KEY,
    employee_id     text,
    employee_name   text NOT NULL,
    key_hash        text NOT NULL UNIQUE,
    key_hint        text NOT NULL DEFAULT '',
    closed_sections text[] NOT NULL DEFAULT '{}',
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_used_at    timestamptz,
    revoked_at      timestamptz
);

COMMENT ON TABLE public.mcp_keys IS
    'Ключи коннектора Claude. Один ключ — один сотрудник. Сам ключ не хранится, только его хеш.';
COMMENT ON COLUMN public.mcp_keys.employee_id IS 'Учётка сотрудника (profiles.id или users.id), которому выдан ключ';
COMMENT ON COLUMN public.mcp_keys.employee_name IS 'Имя сотрудника — так он подписан в журнале вызовов';
COMMENT ON COLUMN public.mcp_keys.key_hash IS 'SHA-256 ключа. По нему ключ и находится';
COMMENT ON COLUMN public.mcp_keys.key_hint IS 'Последние 4 символа ключа — чтобы отличать ключи в списке';
COMMENT ON COLUMN public.mcp_keys.closed_sections IS 'Коды разделов (mcp_section.key), скрытых от этого ключа. Пусто — видно всё';
COMMENT ON COLUMN public.mcp_keys.created_by IS 'Кто выдал ключ';
COMMENT ON COLUMN public.mcp_keys.last_used_at IS 'Когда ключом пользовались последний раз (обновляется не чаще раза в минуту)';
COMMENT ON COLUMN public.mcp_keys.revoked_at IS 'Когда ключ отозван. Отозванный ключ перестаёт работать сразу';

ALTER TABLE public.mcp_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_keys_rw ON public.mcp_keys;
CREATE POLICY mcp_keys_rw ON public.mcp_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.mcp_keys TO postgres, service_role;
GRANT ALL ON SEQUENCE public.mcp_keys_id_seq TO postgres, service_role;

-- ── журнал ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_call_log (
    id            bigserial PRIMARY KEY,
    key_id        bigint REFERENCES public.mcp_keys(id),
    employee_name text NOT NULL DEFAULT '',
    tool          text NOT NULL,
    params        jsonb NOT NULL DEFAULT '{}'::jsonb,
    row_count     int NOT NULL DEFAULT 0,
    duration_ms   int NOT NULL DEFAULT 0,
    error         text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_call_log_at ON public.mcp_call_log (created_at DESC);

COMMENT ON TABLE public.mcp_call_log IS
    'Журнал коннектора Claude: кто, каким инструментом и с какими параметрами читал данные. Хранится не меньше 6 месяцев.';
COMMENT ON COLUMN public.mcp_call_log.key_id IS 'Ключ, которым сделан вызов';
COMMENT ON COLUMN public.mcp_call_log.employee_name IS 'Сотрудник — владелец ключа на момент вызова';
COMMENT ON COLUMN public.mcp_call_log.tool IS 'Имя инструмента коннектора';
COMMENT ON COLUMN public.mcp_call_log.params IS 'Параметры вызова как их прислал Claude';
COMMENT ON COLUMN public.mcp_call_log.row_count IS 'Сколько строк или объектов вернулось';
COMMENT ON COLUMN public.mcp_call_log.duration_ms IS 'Сколько миллисекунд занял вызов';
COMMENT ON COLUMN public.mcp_call_log.error IS 'Текст ошибки, если вызов не удался';

ALTER TABLE public.mcp_call_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_call_log_rw ON public.mcp_call_log;
CREATE POLICY mcp_call_log_rw ON public.mcp_call_log FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.mcp_call_log TO postgres, service_role;
GRANT ALL ON SEQUENCE public.mcp_call_log_id_seq TO postgres, service_role;

-- ── реестр разделов ───────────────────────────────────────────────────────────
--
-- Раздел — это группа таблиц с человеческим названием. Таблица попадает в раздел
-- либо по точному имени (tables), либо по началу имени (prefixes); точное имя
-- сильнее, из начал побеждает самое длинное. Всё, что не подошло никуда, видно в
-- разделе «Прочее» — поэтому новая таблица доступна коннектору сразу, а строка
-- в реестре нужна, чтобы у неё появились место и описание.
--
-- links — связи, которых нет во внешних ключах базы: без них из карточки заказа
-- не видно, где лежат его товары, оплаты и история.

CREATE TABLE IF NOT EXISTS public.mcp_section (
    key         text PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    tables      text[] NOT NULL DEFAULT '{}',
    prefixes    text[] NOT NULL DEFAULT '{}',
    links       jsonb NOT NULL DEFAULT '[]'::jsonb,
    ordering    int NOT NULL DEFAULT 100,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mcp_section IS
    'Реестр разделов ОКК для коннектора Claude: какие таблицы к какому разделу относятся и как они связаны.';
COMMENT ON COLUMN public.mcp_section.key IS 'Код раздела латиницей';
COMMENT ON COLUMN public.mcp_section.title IS 'Название раздела по-русски';
COMMENT ON COLUMN public.mcp_section.description IS 'Что лежит в разделе и на какие вопросы он отвечает';
COMMENT ON COLUMN public.mcp_section.tables IS 'Таблицы раздела по точному имени';
COMMENT ON COLUMN public.mcp_section.prefixes IS 'Начала имён таблиц раздела — новые таблицы с таким началом попадают в раздел сами';
COMMENT ON COLUMN public.mcp_section.links IS
    'Связи между таблицами, не оформленные внешними ключами: [{"from":"таблица.колонка","to":"таблица.колонка","title":"что это"}]';
COMMENT ON COLUMN public.mcp_section.ordering IS 'Порядок показа';

ALTER TABLE public.mcp_section ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_section_rw ON public.mcp_section;
CREATE POLICY mcp_section_rw ON public.mcp_section FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.mcp_section TO postgres, service_role;

INSERT INTO public.mcp_section (key, title, description, tables, prefixes, links, ordering) VALUES
('orders', 'Заказы и клиенты',
 'Заказы, их товары, оплаты, история правок, задачи, договоры и файлы; карточки клиентов и контактов; статусы и переходы. Основная таблица — orders: наш номер заказа в number, технический ключ для связей — order_id.',
 ARRAY['orders','clients','customers','managers','manager_settings','status_settings','point_payments','own_order_payments','document_templates','company_groups','company_group_members'],
 ARRAY['order_','client_','crm_status','tseh_production_'],
 '[
   {"from":"order_items.order_id","to":"orders.order_id","title":"Товары заказа"},
   {"from":"order_payments.order_id","to":"orders.order_id","title":"Оплаты заказа"},
   {"from":"order_history_log.retailcrm_order_id","to":"orders.order_id","title":"История правок заказа"},
   {"from":"call_order_link.order_id","to":"orders.order_id","title":"Звонки по заказу"},
   {"from":"order_files.order_number","to":"orders.number","title":"Файлы заказа"},
   {"from":"order_tasks.order_number","to":"orders.number","title":"Задачи по заказу"},
   {"from":"okk_order_scores.order_id","to":"orders.order_id","title":"Оценка заказа контролем качества"}
 ]'::jsonb, 10),
('calls', 'Звонки и телефония',
 'Звонки Телфина с расшифровками (raw_telphin_calls, текст разговора в transcript), привязка звонка к заказу (call_order_matches, представление call_order_link), входящие и исходящие, события телефонии, очередь расшифровки. retailcrm_calls — архив до 09.10.2026, не пополняется.',
 ARRAY['raw_telphin_calls','active_calls','incoming_calls','outgoing_calls','secretary_calls','transcription_queue','manager_by_extension','manager_call_notifications','retailcrm_calls','dialogue_stats'],
 ARRAY['call_','telphin_'],
 '[]'::jsonb, 20),
('mail', 'Почта',
 'Входящие и исходящие письма общего ящика, их разбор и привязка к заказам, шаблоны и черновики писем по заказу.',
 ARRAY['incoming_emails','outgoing_emails'],
 ARRAY['email_','order_mail_','order_email_'],
 '[
   {"from":"incoming_emails.created_crm_order_number","to":"orders.number","title":"Письма, из которых создан заказ"},
   {"from":"order_email_sends.order_number","to":"orders.number","title":"Письма, отправленные по заказу"}
 ]'::jsonb, 30),
('okk', 'Контроль качества',
 'Критерии и правила контроля качества, оценки заказов (okk_order_scores), нарушения, разговоры с консультантом Семёном.',
 ARRAY['training_examples'],
 ARRAY['okk_'],
 '[]'::jsonb, 40),
('salary', 'Зарплата отдела продаж',
 'Схемы и блоки премий, планы, периоды, готовые расчёты (salary_calc — снимок, с которого читают все экраны), канон клиентов, расчёты инженеров.',
 ARRAY[]::text[],
 ARRAY['salary_'],
 '[]'::jsonb, 50),
('sales', 'Бот-РОП и развитие клиентов',
 'Планы дня менеджеров и их результаты, разбор дня, отношения с клиентами, профили и покупки клиентов, советы по заказам.',
 ARRAY[]::text[],
 ARRAY['sales_','rop_'],
 '[]'::jsonb, 60),
('legal', 'Юридический отдел',
 'Реестр претензионно-исковой работы, исполнительные производства, документы и события по спорам, юрлица группы и их файлы, судебные дела.',
 ARRAY[]::text[],
 ARRAY['legal_','court_'],
 '[]'::jsonb, 70),
('shtab', 'Штаб владельца',
 'Области, минусы, разборы, цели, проекты, программы, оргструктура и посты, задачи; разговоры с Тамарой и её документы.',
 ARRAY['setting_change_proposal','ad_draft_proposal'],
 ARRAY['shtab_','tamara_'],
 '[]'::jsonb, 80),
('lead_catcher', 'Ловец лидов',
 'Обращения с сайта: чат, обратный звонок, корзина; сессии и события виджета, напоминания.',
 ARRAY['lead_reminders'],
 ARRAY['widget_'],
 '[]'::jsonb, 90),
('messenger', 'Корпоративный мессенджер',
 'Чаты сотрудников, участники и сообщения (вложения — в messages.attachments).',
 ARRAY['chats','chat_participants','messages'],
 ARRAY['messenger_'],
 '[]'::jsonb, 100),
('knowledge', 'Базы знаний и промпты',
 'Базы знаний агентов, справка и инструкции, снимок кода проекта, промпты. Читать удобнее инструментами list_knowledge_bases, search_knowledge и get_article.',
 ARRAY['okk_consultant_knowledge','legal_consultant_knowledge','legal_knowledge','project_knowledge','dialog_knowledge','product_knowledge','knowledge_base_qa','shtab_kb','ai_prompts','system_prompts'],
 ARRAY['project_code_'],
 '[]'::jsonb, 110),
('system', 'Система, доступы и настройки',
 'Учётки и роли, права на маршруты, очередь фоновых задач, расход на ИИ, уведомления, реестр доработок, справочники и поля из RetailCRM, журнал самого коннектора.',
 ARRAY['users','profiles','password_reset_tokens','sync_state','runtime_sync_locks','error_logs','alert_seen','improvements','user_view_settings','dashboard_presets','document_read_gate','statuses_udalit_posle_2026_11_24'],
 ARRAY['access_','system_','ai_','notification_','retailcrm_','mcp_'],
 '[]'::jsonb, 120)
ON CONFLICT (key) DO NOTHING;
