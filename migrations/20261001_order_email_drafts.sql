-- Черновики писем по заказу.
--
-- Менеджер пишет письмо и не всегда отправляет его сразу: ждёт расчёт, уточняет
-- цену, уходит на звонок. Сейчас недописанное письмо теряется при закрытии
-- карточки — сохранять было некуда (требование владельца 01.10.2026).
--
-- Черновик один на заказ и автора: второе письмо по тому же заказу менеджер
-- пишет после того, как отправил первое.

CREATE TABLE IF NOT EXISTS public.order_email_drafts (
    id           BIGSERIAL PRIMARY KEY,
    order_number TEXT NOT NULL,
    /** Кто пишет: у каждого свой черновик по заказу. */
    author       TEXT NOT NULL,
    recipient    TEXT,
    subject      TEXT,
    /** Текст как его набрал человек, без разметки: разметку добавляем при отправке. */
    body         TEXT,
    /** Названия приложенных документов — чтобы черновик напоминал, что собирался приложить. */
    attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_number, author)
);

CREATE INDEX IF NOT EXISTS idx_order_email_drafts_order ON public.order_email_drafts (order_number);

ALTER TABLE public.order_email_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.order_email_drafts;
CREATE POLICY "service role full access" ON public.order_email_drafts FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.order_email_drafts IS
  'Недописанные письма по заказу: один черновик на заказ и автора';
