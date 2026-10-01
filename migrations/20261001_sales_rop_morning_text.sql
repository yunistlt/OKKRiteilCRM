-- Текст утреннего плана, как он ушёл менеджеру.
--
-- План открывается менеджеру в CRM при первом входе за день. Показывать надо
-- ровно то письмо, что пришло в Telegram, — с пояснениями и советами, а не
-- пересобранный заново список: пересборка через час даст другой текст, и
-- человек решит, что одна из систем врёт (требование владельца 01.10.2026).

CREATE TABLE IF NOT EXISTS public.sales_rop_morning_message (
    plan_date   DATE NOT NULL,
    manager_id  BIGINT NOT NULL,
    /** Сообщение целиком, как отправлено: markdown-разметки в нём нет, это обычный текст. */
    text        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plan_date, manager_id)
);

ALTER TABLE public.sales_rop_morning_message ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.sales_rop_morning_message;
CREATE POLICY "service role full access" ON public.sales_rop_morning_message FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.sales_rop_morning_message IS
  'Утренний план менеджера текстом — тот же, что ушёл в Telegram';
