-- Ключ задачи дня: «один заказ в день» перестало быть правдой.
--
-- У задач «Отношения с клиентом» заказа нет, и в таблицу они ложились с
-- order_id = 0. Двум таким задачам в одном дне мешало ограничение
-- UNIQUE (plan_date, order_id): запись всего плана падала целиком с
-- «ON CONFLICT DO UPDATE command cannot affect row a second time», и отдел
-- оставался без плана (19–21.10.2026, видно по письму владельцу в Telegram).
--
-- Поэтому у задачи появляется собственный ключ: заказ — по номеру заказа,
-- касание клиента — по менеджеру и клиенту. Уникальность вешаем на него.

ALTER TABLE public.sales_rop_task ADD COLUMN IF NOT EXISTS task_key text;

UPDATE public.sales_rop_task
SET task_key = CASE
        WHEN order_id > 0 THEN 'order:' || order_id
        ELSE 'client:' || coalesce(manager_id::text, '-') || ':' || coalesce(client, '')
    END
WHERE task_key IS NULL;

-- Старые дубли по новому ключу (если найдутся) оставляем в одном экземпляре:
-- в плане это одна и та же работа, записанная дважды.
DELETE FROM public.sales_rop_task t
WHERE EXISTS (
    SELECT 1 FROM public.sales_rop_task o
    WHERE o.plan_date = t.plan_date AND o.task_key = t.task_key AND o.id < t.id
);

ALTER TABLE public.sales_rop_task ALTER COLUMN task_key SET NOT NULL;

ALTER TABLE public.sales_rop_task DROP CONSTRAINT IF EXISTS sales_rop_task_plan_date_order_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS sales_rop_task_plan_date_task_key
    ON public.sales_rop_task (plan_date, task_key);
