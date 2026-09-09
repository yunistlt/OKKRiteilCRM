-- Бот-РОП: утренний план менеджеру и вечерняя проверка касаний.
--
-- Замысел. Продажи почти буквально равны числу выставленных счетов с лагом в
-- день (конверсия «Счёт на оплате» → производство 85 %, медиана 1 день), а
-- счета падают четвёртый месяц. При этом у 124 заказов дата следующего контакта
-- уже прошла — это не потерянные клиенты, а невыполненные обещания перезвонить.
-- Бот каждое утро называет поимённо, что сделать сегодня, а вечером сверяет,
-- было ли касание. Смысл вечернего отчёта не в наказании: невыполненное
-- касание видно в тот же день, а не на разборе через месяц.

-- Настройки: куда слать, во сколько, какие пороги. В коде порогов нет — их
-- меняют без деплоя, и завтра они будут другими.
CREATE TABLE IF NOT EXISTS public.sales_rop_settings (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    comment    text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('telegram_chat_id', '', 'Чат отдела продаж, куда идут план и отчёт. Пусто — бот молчит.'),
    ('tasks_per_manager', '7', 'Сколько задач в утреннем плане на менеджера'),
    ('invoice_stale_days', '2', 'Через сколько дней без касания дожимать счёт на оплате'),
    ('deal_stale_days', '3', 'Через сколько дней без движения дожимать согласование и договор'),
    ('big_deal_amount', '1000000', 'От какой суммы заказ считается крупным'),
    ('big_deal_silence_days', '7', 'Сколько дней молчания по крупному заказу — уже повод'),
    ('enabled', 'true', 'Выключатель на случай отпуска или переналадки')
ON CONFLICT (key) DO NOTHING;

-- Кого тегать. Telegram-имя не выводится из CRM никак, его заводит человек.
CREATE TABLE IF NOT EXISTS public.sales_rop_manager (
    manager_id  bigint PRIMARY KEY,
    telegram_username text NOT NULL DEFAULT '',
    is_active   boolean NOT NULL DEFAULT true,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sales_rop_manager IS
    'Кого бот-РОП тегает в чате отдела продаж. manager_id — из managers.id (это id пользователя RetailCRM).';

-- План на день и его исполнение. Хранится, а не пересобирается вечером: иначе
-- вечерний отчёт проверял бы не то, что утром просили, а то, что подходит под
-- правило сейчас, — и любое изменение статуса за день молча меняло бы задание.
CREATE TABLE IF NOT EXISTS public.sales_rop_task (
    id           bigserial PRIMARY KEY,
    plan_date    date NOT NULL,
    manager_id   bigint,
    order_id     bigint NOT NULL,
    order_number text NOT NULL DEFAULT '',
    client       text NOT NULL DEFAULT '',
    status_code  text NOT NULL DEFAULT '',
    status_name  text NOT NULL DEFAULT '',
    amount       numeric NOT NULL DEFAULT 0,
    -- Причина, по которой заказ попал в план: она же печатается менеджеру.
    reason_code  text NOT NULL,
    reason_text  text NOT NULL,
    weight       numeric NOT NULL DEFAULT 0,
    -- Заполняется вечером.
    touched      boolean,
    touch_kind   text,
    checked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_date, order_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_rop_task_day ON public.sales_rop_task (plan_date, manager_id);

ALTER TABLE public.sales_rop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_rop_manager ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_rop_task ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_rop_settings_rw ON public.sales_rop_settings;
CREATE POLICY sales_rop_settings_rw ON public.sales_rop_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS sales_rop_manager_rw ON public.sales_rop_manager;
CREATE POLICY sales_rop_manager_rw ON public.sales_rop_manager FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS sales_rop_task_rw ON public.sales_rop_task;
CREATE POLICY sales_rop_task_rw ON public.sales_rop_task FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.sales_rop_settings, public.sales_rop_manager, public.sales_rop_task TO postgres, service_role;
GRANT ALL ON SEQUENCE public.sales_rop_task_id_seq TO postgres, service_role;

-- ── данные для бота ───────────────────────────────────────────────────────────

-- Заказы, которые ещё могут стать деньгами, вместе с датой следующего контакта
-- и временем последнего следа работы. Функция, а не запрос в коде: в ней три
-- источника касания, и держать это в TypeScript значило бы тащить их по сети.
DROP FUNCTION IF EXISTS public.sales_rop_presale_orders() CASCADE;
CREATE OR REPLACE FUNCTION public.sales_rop_presale_orders()
RETURNS TABLE (
    order_id bigint, number text, client text, status_code text, status_name text,
    amount numeric, manager_id bigint, manager_name text, telegram_username text,
    contact_date date, last_touch_at timestamptz
)
LANGUAGE sql STABLE AS $function$
    SELECT o.order_id, o.number::text,
           coalesce(o.raw_payload->'customer'->>'nickName', '')::text,
           o.status::text, coalesce(s.name, o.status)::text,
           coalesce(o.totalsumm, 0), o.manager_id,
           trim(coalesce(m.last_name, '') || ' ' || coalesce(m.first_name, ''))::text,
           coalesce(m.raw_data->>'telegram_username', '')::text,
           nullif(o.raw_payload->'customFields'->>'data_kontakta', '')::date,
           GREATEST(
               o.updated_at,
               coalesce((SELECT max(h.occurred_at) FROM public.order_history_log h
                          WHERE h.retailcrm_order_id = o.order_id), o.updated_at)
           )
      FROM public.orders o
      JOIN public.statuses s ON s.code = o.status
      LEFT JOIN public.managers m ON m.id = o.manager_id
     WHERE o.status IN ('prepayed','availability','raschet','na-soglasovanii','v-proscete',
                        'otmenili-zakupku-smeta','ozidanie-tz','zapros-kontaktov','tender',
                        'ozhidanie-vykhoda-tendera','otlozeno','novyi-1')
       -- Заказ без суммы — это незаполненный просчёт, звонить по нему не о чем.
       AND coalesce(o.totalsumm, 0) > 0
       AND o.updated_at >= now() - interval '400 days';
$function$;

-- Касание по заказу за день: комментарий, смена статуса, перенос даты контакта,
-- письмо или звонок. Широко намеренно — задача увидеть работу, а не поймать.
CREATE OR REPLACE FUNCTION public.sales_rop_touches(p_date date)
RETURNS TABLE (order_id bigint, touch_kind text)
LANGUAGE sql STABLE AS $function$
    SELECT order_id, min(kind) AS touch_kind FROM (
        SELECT h.retailcrm_order_id AS order_id,
               CASE h.field
                   WHEN 'manager_comment' THEN 'комментарий'
                   WHEN 'status' THEN 'смена статуса'
                   WHEN 'custom_data_kontakta' THEN 'перенос даты'
                   ELSE 'правка заказа'
               END AS kind
          FROM public.order_history_log h
         WHERE h.occurred_at >= p_date::timestamptz
           AND h.occurred_at < (p_date + 1)::timestamptz
        UNION ALL
        SELECT e.order_id, 'письмо'
          FROM public.order_email_sends e
         WHERE e.created_at >= p_date::timestamptz AND e.created_at < (p_date + 1)::timestamptz
           AND e.order_id IS NOT NULL
        UNION ALL
        SELECT c.retailcrm_order_id, 'звонок'
          FROM public.call_order_matches c
         WHERE c.matched_at >= p_date::timestamptz AND c.matched_at < (p_date + 1)::timestamptz
    ) t
    WHERE order_id IS NOT NULL
    GROUP BY order_id;
$function$;

-- Цифры дня для шапки вечернего отчёта.
CREATE OR REPLACE FUNCTION public.sales_rop_day_facts(p_date date)
RETURNS TABLE (
    invoices_count bigint, invoices_sum numeric,
    sold_count bigint, sold_sum numeric, month_sold numeric
)
LANGUAGE sql STABLE AS $function$
    WITH ev AS (
        SELECT retailcrm_order_id, (new_value::jsonb->>'code') AS code, occurred_at
          FROM public.order_history_log
         WHERE field = 'status' AND occurred_at >= date_trunc('month', p_date::timestamptz)
    ),
    bills AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev WHERE code = 'prepayed' GROUP BY 1
    ),
    sales AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev
         WHERE code IN ('send-assembling', 'zagruzen-systemu') GROUP BY 1
    )
    SELECT
        (SELECT count(*) FROM bills b WHERE b.at >= p_date::timestamptz AND b.at < (p_date + 1)::timestamptz),
        coalesce((SELECT sum(o.totalsumm) FROM bills b JOIN public.orders o ON o.order_id = b.retailcrm_order_id
                   WHERE b.at >= p_date::timestamptz AND b.at < (p_date + 1)::timestamptz), 0),
        (SELECT count(*) FROM sales s WHERE s.at >= p_date::timestamptz AND s.at < (p_date + 1)::timestamptz),
        coalesce((SELECT sum(o.totalsumm) FROM sales s JOIN public.orders o ON o.order_id = s.retailcrm_order_id
                   WHERE s.at >= p_date::timestamptz AND s.at < (p_date + 1)::timestamptz), 0),
        coalesce((SELECT sum(o.totalsumm) FROM sales s JOIN public.orders o ON o.order_id = s.retailcrm_order_id), 0);
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_presale_orders() TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_rop_touches(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_rop_day_facts(date) TO service_role;

INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('overdue_limit_days', '90', 'Просрочка старше этого срока — потеряшка, а не задача на сегодня'),
    ('lost_per_day', '2', 'Сколько потеряшек добавлять сверх плана'),
    ('month_plan', '13000000', 'План продаж на месяц, рублей')
ON CONFLICT (key) DO NOTHING;

-- ── простановка даты контакта в CRM ───────────────────────────────────────────
-- План живёт не только в Telegram: заказ должен всплыть у менеджера на его
-- рабочем экране в RetailCRM. Поэтому утренний прогон проставляет дату
-- следующего контакта на сегодня, а результат записи храним — молчаливо
-- провалившаяся запись в CRM хуже, чем её отсутствие.
ALTER TABLE public.sales_rop_task ADD COLUMN IF NOT EXISTS crm_date_set boolean;
ALTER TABLE public.sales_rop_task ADD COLUMN IF NOT EXISTS crm_error text;

-- site заказа нужен для orders/edit: при чужом site RetailCRM отвечает «Not found».
-- Набор колонок меняется, поэтому старую версию сначала убираем: Postgres не
-- даёт заменить возвращаемый тип через CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.sales_rop_presale_orders() CASCADE;
CREATE OR REPLACE FUNCTION public.sales_rop_presale_orders()
RETURNS TABLE (
    order_id bigint, number text, client text, status_code text, status_name text,
    amount numeric, manager_id bigint, manager_name text, telegram_username text,
    contact_date date, last_touch_at timestamptz, site text
)
LANGUAGE sql STABLE AS $function$
    SELECT o.order_id, o.number::text,
           coalesce(o.raw_payload->'customer'->>'nickName', '')::text,
           o.status::text, coalesce(s.name, o.status)::text,
           coalesce(o.totalsumm, 0), o.manager_id,
           trim(coalesce(m.last_name, '') || ' ' || coalesce(m.first_name, ''))::text,
           coalesce(m.raw_data->>'telegram_username', '')::text,
           nullif(o.raw_payload->'customFields'->>'data_kontakta', '')::date,
           GREATEST(
               o.updated_at,
               coalesce((SELECT max(h.occurred_at) FROM public.order_history_log h
                          WHERE h.retailcrm_order_id = o.order_id), o.updated_at)
           ),
           coalesce(o.site, o.raw_payload->>'site', '')::text
      FROM public.orders o
      JOIN public.statuses s ON s.code = o.status
      LEFT JOIN public.managers m ON m.id = o.manager_id
     WHERE o.status IN ('prepayed','availability','raschet','na-soglasovanii','v-proscete',
                        'otmenili-zakupku-smeta','ozidanie-tz','zapros-kontaktov','tender',
                        'ozhidanie-vykhoda-tendera','otlozeno','novyi-1')
       AND coalesce(o.totalsumm, 0) > 0
       AND o.updated_at >= now() - interval '400 days';
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_presale_orders() TO service_role;

INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('set_crm_contact_date', 'true', 'Проставлять ли дату следующего контакта в карточке заказа RetailCRM')
ON CONFLICT (key) DO NOTHING;

-- Кому уходят задачи уволенных и тех, у кого нет ника: без этого блок висит
-- без адресата и его не делает никто.
INSERT INTO public.sales_rop_settings (key, value, comment) VALUES
    ('orphan_telegram', 'zmktlt', 'Ник, которого тегать в блоке «менеджер неактивен»')
ON CONFLICT (key) DO NOTHING;

DROP FUNCTION IF EXISTS public.sales_rop_presale_orders() CASCADE;
CREATE OR REPLACE FUNCTION public.sales_rop_presale_orders()
RETURNS TABLE (
    order_id bigint, number text, client text, status_code text, status_name text,
    amount numeric, manager_id bigint, manager_name text, telegram_username text,
    contact_date date, last_touch_at timestamptz, site text, manager_active boolean
)
LANGUAGE sql STABLE AS $function$
    SELECT o.order_id, o.number::text,
           coalesce(o.raw_payload->'customer'->>'nickName', '')::text,
           o.status::text, coalesce(s.name, o.status)::text,
           coalesce(o.totalsumm, 0), o.manager_id,
           trim(coalesce(m.last_name, '') || ' ' || coalesce(m.first_name, ''))::text,
           coalesce(m.raw_data->>'telegram_username', '')::text,
           nullif(o.raw_payload->'customFields'->>'data_kontakta', '')::date,
           GREATEST(
               o.updated_at,
               coalesce((SELECT max(h.occurred_at) FROM public.order_history_log h
                          WHERE h.retailcrm_order_id = o.order_id), o.updated_at)
           ),
           coalesce(o.site, o.raw_payload->>'site', '')::text,
           coalesce(m.active, false)
      FROM public.orders o
      JOIN public.statuses s ON s.code = o.status
      LEFT JOIN public.managers m ON m.id = o.manager_id
     WHERE o.status IN ('prepayed','availability','raschet','na-soglasovanii','v-proscete',
                        'otmenili-zakupku-smeta','ozidanie-tz','zapros-kontaktov','tender',
                        'ozhidanie-vykhoda-tendera','otlozeno','novyi-1')
       AND coalesce(o.totalsumm, 0) > 0
       AND o.updated_at >= now() - interval '400 days';
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_presale_orders() TO service_role;
