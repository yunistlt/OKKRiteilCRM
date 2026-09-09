-- Полное досье по заказу: вся история, а не последние восемь событий.
--
-- Рекомендация стоит ровно столько, сколько прочитано перед ней. Обрезанная
-- история — это совет по половине разговора: в заказе №54132 суть («ждут
-- письмо о переименовании продукции») лежала в комментарии, а причина задержки
-- («навигация, контейнеры, сдача объекта горит») — в записи двухнедельной
-- давности.
--
-- Отдаём всё разом одной функцией: три отдельных запроса на каждый заказ — это
-- три похода по сети там, где нужен один.
CREATE OR REPLACE FUNCTION public.sales_order_full_history(p_order_id bigint)
RETURNS TABLE (
    occurred_at timestamptz,
    kind text,
    detail text
)
LANGUAGE sql STABLE AS $function$
    -- Смены статуса: путь заказа целиком.
    SELECT h.occurred_at, 'статус'::text,
           coalesce(s.name, (h.new_value::jsonb->>'code'), '?')::text
      FROM public.order_history_log h
      LEFT JOIN public.statuses s ON s.code = (h.new_value::jsonb->>'code')
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'status'

    UNION ALL

    -- Комментарии менеджера в истории: в карточке виден только последний, а
    -- переписывают его поверх — предыдущие договорённости остаются здесь.
    SELECT h.occurred_at, 'комментарий'::text, left(h.new_value::text, 600)
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id AND h.field = 'manager_comment'

    UNION ALL

    -- Деньги и состав: смена суммы или позиций меняет разговор с клиентом.
    SELECT h.occurred_at, 'изменение заказа'::text,
           (h.field || ': ' || left(coalesce(h.new_value::text, ''), 200))
      FROM public.order_history_log h
     WHERE h.retailcrm_order_id = p_order_id
       AND h.field IN ('payments.amount', 'order_product', 'order_product.summ', 'custom_data_kontakta')

    UNION ALL

    -- Письма: их не читал никто, а там отправленные КП и счета.
    SELECT e.created_at, 'письмо'::text, left(coalesce(e.subject, ''), 200)
      FROM public.order_email_sends e
     WHERE e.order_id = p_order_id

    ORDER BY 1 DESC
    LIMIT 60;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_order_full_history(bigint) TO service_role;

-- Звонки по клиенту, а не только по этому заказу: клиент один, разговоры общие,
-- и договорённость нередко записана в звонке по соседнему заказу.
CREATE OR REPLACE FUNCTION public.sales_client_calls_by_order(p_order_id bigint)
RETURNS TABLE (started_at timestamptz, order_number text, transcript text)
LANGUAGE sql STABLE AS $function$
    WITH me AS (
        SELECT coalesce(nullif(o.raw_payload->'contragent'->>'INN', ''),
                        'cid:' || coalesce(o.raw_payload->'customer'->>'id', o.order_id::text)) AS client_key
          FROM public.orders o WHERE o.order_id = p_order_id
    ),
    sibling AS (
        SELECT DISTINCT p.order_id, p.number
          FROM public.sales_client_purchases_mv p, me
         WHERE p.client_key = me.client_key
        UNION SELECT p_order_id, NULL
    )
    SELECT r.started_at, sibling.number::text, left(r.transcript, 3000)
      FROM sibling
      JOIN public.call_order_matches m ON m.retailcrm_order_id = sibling.order_id
      JOIN public.raw_telphin_calls r ON r.telphin_call_id = m.telphin_call_id
     WHERE r.transcript IS NOT NULL AND length(r.transcript) > 200
     ORDER BY r.started_at DESC
     LIMIT 5;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_client_calls_by_order(bigint) TO service_role;
