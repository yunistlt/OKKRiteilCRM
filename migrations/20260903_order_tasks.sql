-- Задачи по заказу. Кнопка «Задачи 0/0» в карточке была нарисованной — счётчик
-- захардкожен, хранилища не существовало.

CREATE TABLE IF NOT EXISTS public.order_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL,          -- номер заказа RetailCRM, по нему и связь
    title TEXT NOT NULL,
    due_date DATE,
    done BOOLEAN NOT NULL DEFAULT false,
    done_at TIMESTAMPTZ,
    created_by TEXT,                     -- кто поставил: имя или роль из сессии
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_tasks_order ON public.order_tasks(order_number, done);
CREATE INDEX IF NOT EXISTS idx_order_tasks_due ON public.order_tasks(due_date) WHERE done = false;

ALTER TABLE public.order_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.order_tasks;
CREATE POLICY "service role full access" ON public.order_tasks FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_order_tasks_touch ON public.order_tasks;
CREATE TRIGGER trg_order_tasks_touch BEFORE UPDATE ON public.order_tasks
    FOR EACH ROW EXECUTE FUNCTION public.touch_template_updated_at();

COMMENT ON TABLE public.order_tasks IS 'Задачи менеджера по заказу: что сделать и к какому сроку';
