-- Сверка дня не считает работой то, что сделал сам бот.
--
-- Доработки №86–№90 (Ирина Гордеева, 10.11.2026): «звонок совершён, дата
-- переставлена — задача не уходит», «работать по задачам Мой день невозможно».
-- В плане на 11.11 у всех семи задач стояло «Нарушение: дату перенесли без
-- причины» — при том что дату не переносил никто из людей.
--
-- Причина: утренний план сам проставляет дату следующего контакта в заказе
-- (`setContactDate`, настройка set_crm_contact_date). Запись уходит в историю
-- заказа от имени менеджера заказа — другого автора у неё не было. Сверка
-- видела изменение `custom_data_kontakta` без комментария в тот же день и
-- называла это переносом даты без причины, то есть обвиняла человека в работе
-- робота.
--
-- Источник чиним там, где он врал: правки бота теперь помечаются в истории
-- (`user_data->>'bot'`, см. lib/own-crm/history-write.ts), а сверка их не
-- смотрит — ни как нарушение, ни как отработанную задачу.
--
-- Задним числом старые записи не лечим: в них отметки нет, и отличить правку
-- бота от правки человека в них нечем.

CREATE OR REPLACE FUNCTION public.sales_rop_touches(p_date date)
 RETURNS TABLE(order_id bigint, touch_kind text)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT t.order_id,
           (ARRAY[
               'звонок', 'письмо', 'смена статуса', 'перенос даты',
               'правка заказа', 'комментарий', 'перенос даты без причины'
           ])[
               min(
                   CASE t.kind
                       WHEN 'звонок' THEN 1
                       WHEN 'письмо' THEN 2
                       WHEN 'смена статуса' THEN 3
                       WHEN 'перенос даты' THEN 4
                       WHEN 'правка заказа' THEN 5
                       WHEN 'комментарий' THEN 6
                       ELSE 7
                   END
               )
           ] AS touch_kind
      FROM (
        SELECT h.retailcrm_order_id AS order_id,
               CASE
                   WHEN h.field = 'manager_comment' THEN 'комментарий'
                   WHEN h.field = 'status' THEN 'смена статуса'
                   WHEN h.field = 'custom_data_kontakta' THEN
                       CASE WHEN EXISTS (
                           SELECT 1 FROM public.order_history_log c
                            WHERE c.retailcrm_order_id = h.retailcrm_order_id
                              AND c.field = 'manager_comment'
                              AND c.occurred_at >= p_date::timestamptz
                              AND c.occurred_at < (p_date + 1)::timestamptz
                       ) THEN 'перенос даты' ELSE 'перенос даты без причины' END
                   ELSE 'правка заказа'
               END AS kind
          FROM public.order_history_log h
         WHERE h.occurred_at >= p_date::timestamptz
           AND h.occurred_at < (p_date + 1)::timestamptz
           -- Правка робота — не работа менеджера.
           AND h.user_data->>'bot' IS NULL
        UNION ALL
        SELECT e.order_id, 'письмо'
          FROM public.order_email_sends e
         WHERE e.created_at >= p_date::timestamptz AND e.created_at < (p_date + 1)::timestamptz
           AND e.order_id IS NOT NULL
        UNION ALL
        -- Звонок засчитываем только как состоявшийся разговор.
        SELECT l.order_id, 'звонок'
          FROM public.call_order_links_for_day(p_date) l
         WHERE l.answered
      ) t
     GROUP BY t.order_id;
$function$;
