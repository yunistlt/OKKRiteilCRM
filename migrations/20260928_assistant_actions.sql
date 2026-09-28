-- Действия, которые помощник менеджера готовит, но не выполняет сам.
--
-- Письмо клиенту и звонок — это выход наружу: отменить их нельзя. Поэтому модель
-- только СОБИРАЕТ действие и кладёт сюда, а выполняется оно после того, как менеджер
-- нажал «Отправить». Так у ошибки помощника есть последний рубеж — живой человек.

CREATE TABLE IF NOT EXISTS public.assistant_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id BIGINT NOT NULL,               -- от чьего имени действие (managers.id)
    kind TEXT NOT NULL,                       -- email | call
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | done | cancelled | failed
    payload JSONB NOT NULL,                   -- что именно отправить/кому звонить
    preview TEXT,                             -- как это выглядит человеку в подтверждении
    order_number TEXT,                        -- заказ, к которому относится
    result JSONB,                             -- чем закончилось выполнение
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,                   -- когда менеджер подтвердил или отменил
    CONSTRAINT assistant_actions_kind_check CHECK (kind IN ('email', 'call')),
    CONSTRAINT assistant_actions_status_check CHECK (status IN ('pending', 'done', 'cancelled', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_pending
    ON public.assistant_actions(manager_id, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_assistant_actions_manager
    ON public.assistant_actions(manager_id, created_at DESC);

ALTER TABLE public.assistant_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.assistant_actions;
CREATE POLICY "service role full access" ON public.assistant_actions FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.assistant_actions IS 'Действия помощника менеджера, ожидающие подтверждения человеком';
COMMENT ON COLUMN public.assistant_actions.preview IS 'Текст для окна подтверждения: что именно произойдёт по нажатию';
