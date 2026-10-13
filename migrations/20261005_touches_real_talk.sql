-- ============================================================================
-- Отработка задачи дня: звонок — только разговор, перенос даты без причины —
-- нарушение.
--
-- Два закона владельца от 05.10.2026.
--
-- 1. «Проверь точно ли был разговор с клиентом или была попытка дозвона.
--    Результатом является только разговор». Касание «звонок» засчитывалось по
--    самому факту звонка. Пример того же дня: заказ 54023 «Кот Автотранс» —
--    в плане «Отработан: звонок», а разговор длился 0 секунд, записи нет, ни
--    одно плечо не говорило. Теперь звонок считается работой, только если
--    разговор состоялся: хоть одно плечо разговаривало или осталась запись.
--
-- 2. «Перенос даты без причины является нарушением, надо писать что нарушение,
--    а не отработан». Перенос даты следующего контакта засчитывался отработкой
--    сам по себе — им можно бесконечно отодвигать работу. Теперь он считается
--    отработкой, только если в тот же день по заказу есть комментарий
--    менеджера, то есть объяснение. Без объяснения — отдельный вид
--    «перенос даты без причины», интерфейс показывает его как нарушение.
--    Сегодняшний день: 49 переносов с объяснением, 5 — без.
--
-- Порядок видов прежний, нарушение — в самом конце: любая настоящая работа по
-- заказу его перебивает.
-- ============================================================================

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
        -- Правки заказа. Перенос даты отделён: он отработка только с
        -- объяснением в тот же день.
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
        UNION ALL
        SELECT e.order_id, 'письмо'
          FROM public.order_email_sends e
         WHERE e.created_at >= p_date::timestamptz AND e.created_at < (p_date + 1)::timestamptz
           AND e.order_id IS NOT NULL
        UNION ALL
        -- Звонок засчитываем ТОЛЬКО как состоявшийся разговор. Связь звонка с
        -- заказом и признак разговора живут в одном месте — call_order_link.
        SELECT l.order_id, 'звонок'
          FROM public.call_order_link l
         WHERE l.started_at >= p_date::timestamptz
           AND l.started_at < (p_date + 1)::timestamptz
           AND l.answered
      ) t
     GROUP BY t.order_id;
$function$;

COMMENT ON FUNCTION public.sales_rop_touches(date) IS
    'Чем менеджер отработал задачу дня. Звонок — только состоявшийся разговор (закон владельца 05.10.2026). «Перенос даты без причины» — нарушение: дату отодвинули, не объяснив.';
