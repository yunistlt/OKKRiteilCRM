-- Звонок привязывается к заказу самой CRM, а не нашим матчингом.
--
-- В RetailCRM звонок связан с заказом там же, где работает менеджер: выгрузка
-- телефонии отдаёт номер заказа, менеджера и идентификатор записи. Наш матчинг
-- по номеру телефона ошибается примерно в трети случаев — он угадывает то, что
-- CRM знает.
--
-- Сегодня в retailcrm_calls 18 909 звонков, из них 15 257 с номером заказа, и
-- синк живой. Значит основной источник есть; наш матчинг остаётся запасным для
-- заказов, которых в выгрузке нет.
--
-- Проверка на 22.09: наш матчинг дал 79 заказов со звонком, CRM — 56. Наш
-- «находит» больше ровно потому, что часть находок выдумана.

ALTER TABLE public.sales_rop_task_result
    ADD COLUMN IF NOT EXISTS call_source TEXT;

COMMENT ON COLUMN public.sales_rop_task_result.call_source IS
    'crm — привязка из RetailCRM (точная), match — наш матчинг по телефону (запасной)';

-- Касание «звонок» тоже считается по данным CRM, с нашим матчингом как
-- запасным. Время разговора берётся из самого звонка: раньше бралось время
-- сопоставления, и за тридцать дней 1499 из 2365 звонков уезжали не в свой
-- день, со средним отрывом в 99 часов.
CREATE OR REPLACE FUNCTION public.sales_rop_touches(p_date date)
 RETURNS TABLE(order_id bigint, touch_kind text)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT t.order_id,
           -- Внешний след впереди записи о работе: звонок и письмо доказывают
           -- контакт с клиентом, комментарий — только намерение.
           (ARRAY['звонок', 'письмо', 'смена статуса', 'перенос даты', 'правка заказа', 'комментарий'])[
               min(
                   CASE t.kind
                       WHEN 'звонок' THEN 1
                       WHEN 'письмо' THEN 2
                       WHEN 'смена статуса' THEN 3
                       WHEN 'перенос даты' THEN 4
                       WHEN 'правка заказа' THEN 5
                       ELSE 6
                   END
               )
           ] AS touch_kind
      FROM (
        SELECT h.retailcrm_order_id AS order_id,
               CASE h.field
                   WHEN 'manager_comment' THEN 'комментарий'
                   WHEN 'status' THEN 'смена статуса'
                   WHEN 'custom_data_kontakta' THEN 'перенос даты'
                   ELSE 'правка заказа'
               END AS kind
          FROM public.order_history_log h
         WHERE h.occurred_at >= p_date::timestamptz
           AND h.occurred_at < (p_date + 1)::timestamptz
        UNION ALL
        SELECT e.order_id, 'письмо'
          FROM public.order_email_sends e
         WHERE e.created_at >= p_date::timestamptz AND e.created_at < (p_date + 1)::timestamptz
           AND e.order_id IS NOT NULL
        UNION ALL
        -- Основной источник: привязка сделана в CRM.
        SELECT o.id, 'звонок'
          FROM public.retailcrm_calls c
          JOIN public.orders o ON o.number = c.order_number
         WHERE c.order_number IS NOT NULL
           AND c.call_date >= p_date::timestamptz
           AND c.call_date < (p_date + 1)::timestamptz
        UNION ALL
        -- Запасной: наш матчинг, по времени разговора.
        SELECT m.retailcrm_order_id, 'звонок'
          FROM public.call_order_matches m
          JOIN public.raw_telphin_calls rc ON rc.telphin_call_id = m.telphin_call_id
         WHERE rc.started_at >= p_date::timestamptz
           AND rc.started_at < (p_date + 1)::timestamptz
           -- Только там, где CRM про этот заказ в этот день ничего не сказала.
           AND NOT EXISTS (
               SELECT 1 FROM public.retailcrm_calls c2
                 JOIN public.orders o2 ON o2.number = c2.order_number
                WHERE o2.id = m.retailcrm_order_id
                  AND c2.call_date >= p_date::timestamptz
                  AND c2.call_date < (p_date + 1)::timestamptz
           )
      ) t
     WHERE t.order_id IS NOT NULL
     GROUP BY t.order_id;
$function$;
