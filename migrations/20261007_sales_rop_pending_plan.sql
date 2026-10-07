-- ============================================================================
-- План дня, придержанный до прочтения разбора.
--
-- Разбор идёт перед планом: если менеджер утром ещё не прочитал разбор, его
-- личный план не отправляется. Выбросить его нельзя — человек останется без
-- работы на день. Поэтому текст плана кладётся сюда, а добивка (крон раз в
-- десять минут в рабочие часы) отправляет его, как только разбор подтверждён.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sales_rop_pending_plan (
    id bigserial PRIMARY KEY,
    manager_id bigint NOT NULL,
    plan_date date NOT NULL,
    recipient_name text,
    text text NOT NULL,
    manager_chat_id text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (manager_id, plan_date)
);

COMMENT ON TABLE public.sales_rop_pending_plan IS
    'План дня, который ждёт прочтения разбора. Отправляется добивкой после подтверждения.';

CREATE INDEX IF NOT EXISTS sales_rop_pending_plan_unsent_idx
    ON public.sales_rop_pending_plan (plan_date) WHERE sent_at IS NULL;
