-- Что на самом деле случилось с задачей дня.
--
-- Отметки «тронуто» не хватает: комментарий в карточке и разговор с клиентом
-- одинаково считались работой, а это разные вещи. Комментарий пишет менеджер
-- сам о себе; звонок, письмо и ответ клиента — след, который оставил кто-то
-- ещё. По отметке «тронуто» невозможно ответить на вопрос, ради которого всё
-- это заводится: кому можно дать больше работы.
--
-- Цепочка одна и та же для любой задачи:
--   выдана → тронута → был контакт → клиент ответил → заказ сдвинулся → деньги.
-- Каждая ступень выше предыдущей, и уровень задачи — это самая высокая
-- достигнутая ступень.
--
-- Почему таблица фактов, а не витрина с готовыми процентами: проценты
-- пересчитываются из фактов в любой момент и по любому срезу, а факты задним
-- числом не восстановить. Витрины — представления поверх этой таблицы.

CREATE TABLE IF NOT EXISTS public.sales_rop_task_result (
    plan_date        DATE NOT NULL,
    order_id         BIGINT NOT NULL,
    manager_id       BIGINT,
    reason_code      TEXT,
    amount           NUMERIC(14,2),

    -- Ступень 1: след в карточке.
    touched          BOOLEAN NOT NULL DEFAULT false,
    touch_kind       TEXT,

    -- Ступень 2: подтверждённый контакт. Звонки схлопнуты: один разговор через
    -- очередь даёт несколько строк телефонии, и без схлопывания активность
    -- выглядит втрое выше, чем была.
    calls_count      INT NOT NULL DEFAULT 0,
    call_seconds     INT NOT NULL DEFAULT 0,
    call_first_at    TIMESTAMPTZ,
    emails_count     INT NOT NULL DEFAULT 0,

    -- Ступень 3: ответил ли клиент. Входящий звонок или входящее письмо —
    -- единственное, что доказывает не «мы позвонили», а «с нами говорят».
    client_replied   BOOLEAN NOT NULL DEFAULT false,
    client_reply_at  TIMESTAMPTZ,

    -- Ступень 4: сдвинулся ли заказ.
    movement_type    TEXT,
    movement_at      TIMESTAMPTZ,

    -- Ступень 5: деньги. Продажей считается уход в производство — по этому же
    -- правилу считается зарплата отдела. Приход по банку сюда не смешивается:
    -- это деньги всей группы, а не результат менеджера.
    money_type       TEXT,
    money_amount     NUMERIC(14,2),
    money_at         TIMESTAMPTZ,

    -- Самая высокая достигнутая ступень, 0–5.
    result_level     SMALLINT NOT NULL DEFAULT 0,
    result_status    TEXT NOT NULL DEFAULT 'not_touched',

    calculated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    details          JSONB,

    PRIMARY KEY (plan_date, order_id)
);

CREATE INDEX IF NOT EXISTS idx_rop_task_result_manager
    ON public.sales_rop_task_result (manager_id, plan_date DESC);

ALTER TABLE public.sales_rop_task_result ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.sales_rop_task_result.result_status IS
    'not_touched | comment_only | crm_touched | confirmed_contact | client_replied | order_moved | money_result | closed_lost_unconfirmed';

-- Дневная витрина. Представление, а не таблица: проценты, разошедшиеся с
-- фактами, хуже отсутствующих процентов.
CREATE OR REPLACE VIEW public.sales_rop_manager_day_stats AS
SELECT r.plan_date                                                  AS work_date,
       r.manager_id,
       count(*)::int                                                AS tasks_issued,
       count(*) FILTER (WHERE r.touched)::int                       AS tasks_touched,
       count(*) FILTER (WHERE NOT r.touched)::int                   AS tasks_not_touched,
       -- Закрыто одной записью о себе: главный показатель чистоты работы.
       count(*) FILTER (WHERE r.result_status = 'comment_only')::int AS tasks_comment_only,
       count(*) FILTER (WHERE r.result_level >= 2)::int             AS tasks_confirmed_contact,
       count(*) FILTER (WHERE r.result_level >= 3)::int             AS tasks_client_replied,
       count(*) FILTER (WHERE r.result_level >= 4)::int             AS tasks_order_moved,
       count(*) FILTER (WHERE r.result_level >= 5)::int             AS tasks_money_result,
       count(*) FILTER (WHERE r.result_status = 'closed_lost_unconfirmed')::int AS tasks_closed_unconfirmed,
       coalesce(sum(r.calls_count), 0)::int                         AS calls_count,
       coalesce(sum(r.call_seconds), 0)::int                        AS call_seconds,
       coalesce(sum(r.emails_count), 0)::int                        AS emails_count,
       coalesce(sum(r.money_amount) FILTER (WHERE r.money_type = 'sent_to_production'), 0)::numeric AS production_amount,
       count(*) FILTER (WHERE r.money_type = 'sent_to_production')::int AS production_count
  FROM public.sales_rop_task_result r
 GROUP BY r.plan_date, r.manager_id;
