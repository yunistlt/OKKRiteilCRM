-- Чистка досье: модель должна читать факты о клиенте, а не наши же советы.
--
-- В историю попадали заметки РОПа (мы сами их и пишем в комментарий) и сырой
-- JSON позиций заказа. Первое — эхо: модель читает собственный совет и повторяет
-- его. Второе съедает контекст и не говорит ничего: «order_product: {"id":106218,
-- "offer":{...}}» вместо «добавлена позиция».
CREATE OR REPLACE FUNCTION public.sales_order_full_history(p_order_id bigint)
RETURNS TABLE (occurred_at timestamptz, kind text, detail text)
LANGUAGE sql STABLE AS $function$
    SELECT h.occurred_at, 'статус'::text,
           coalesce(s.name, (h.new_value::jsonb->>'code'), '?')::text
      FROM public.order_history_log h
      LEFT JOIN public.statuses s ON s.code = (h.new_value::jsonb->>'code')
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'status'

    UNION ALL

    SELECT h.occurred_at, 'комментарий'::text, left(h.new_value::text, 600)
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'manager_comment'
       -- Свои заметки не возвращаем: иначе модель читает собственный вчерашний
       -- совет и повторяет его как факт о клиенте.
       AND h.new_value::text !~ '\d{2}\.\d{2}\.\d{4}\s+РОП:'

    UNION ALL

    -- Сумма: только величина, без служебных полей.
    SELECT h.occurred_at, 'сумма заказа'::text,
           (round(h.new_value::text::numeric)::text || ' руб')
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id
       AND h.field = 'payments.amount'
       AND h.new_value::text ~ '^[0-9.]+$'

    UNION ALL

    -- Состав: название позиции вместо JSON.
    SELECT h.occurred_at, 'позиция заказа'::text,
           coalesce(nullif(h.new_value::jsonb->'offer'->>'name', ''), 'состав изменён')
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'order_product'
       AND h.new_value::text <> 'null'

    UNION ALL

    SELECT h.occurred_at, 'дата контакта'::text, left(coalesce(h.new_value::text, ''), 40)
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'custom_data_kontakta'

    UNION ALL

    SELECT e.created_at, 'письмо'::text, left(coalesce(e.subject, ''), 200)
      FROM public.order_email_sends e
     WHERE e.order_id = p_order_id

    ORDER BY 1 DESC
    LIMIT 60;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_order_full_history(bigint) TO service_role;
