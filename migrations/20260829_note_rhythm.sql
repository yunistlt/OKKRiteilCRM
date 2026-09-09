-- Когда писать новую заметку РОПа, а когда молчать.
--
-- Если предыдущая рекомендация висит нетронутой — менеджер по заказу ничего не
-- сделал, — писать новую бессмысленно и вредно: в карточке копится столбик
-- одинаковых советов, и их перестают читать все, включая того, кто их пишет.
--
-- Новая заметка нужна тогда, когда после предыдущей что-то произошло: менеджер
-- оставил комментарий, сменил статус, позвонил, отправил письмо. Тогда ситуация
-- другая и совет должен быть другим.

ALTER TABLE public.sales_rop_task ADD COLUMN IF NOT EXISTS note_written_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_rop_task_note ON public.sales_rop_task (order_id, note_written_at DESC);

-- Когда по заказу последний раз писали заметку и когда последний раз работал
-- человек. Одним запросом, чтобы не гонять две выборки на каждый заказ.
CREATE OR REPLACE FUNCTION public.sales_rop_note_state(p_order_id bigint)
RETURNS TABLE (last_note_at timestamptz, last_touch_at timestamptz)
LANGUAGE sql STABLE AS $function$
    SELECT
        (SELECT max(t.note_written_at) FROM public.sales_rop_task t
          WHERE t.order_id = p_order_id AND t.note_written_at IS NOT NULL),
        -- Касание человека: комментарий, смена статуса, перенос даты, письмо,
        -- звонок. Наши собственные правки полем «дата контакта» сюда не идут —
        -- иначе бот считал бы работой то, что сделал сам.
        GREATEST(
            (SELECT max(h.occurred_at) FROM public.order_history_log h
              WHERE h.retailcrm_order_id = p_order_id
                AND h.field IN ('manager_comment', 'status', 'order_product', 'payments.amount')),
            (SELECT max(e.created_at) FROM public.order_email_sends e WHERE e.order_id = p_order_id),
            (SELECT max(c.matched_at) FROM public.call_order_matches c WHERE c.retailcrm_order_id = p_order_id)
        );
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_note_state(bigint) TO service_role;
