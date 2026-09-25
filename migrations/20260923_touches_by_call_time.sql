-- Касание «звонок» — по времени разговора, а не по времени сопоставления.
--
-- Было: звонок относился к тому дню, когда сработал матчинг звонка с заказом.
-- Матчинг догоняет позже, иногда сильно: за тридцать дней у 1499 из 2365
-- сопоставлений дата матчинга не совпадала с датой звонка, средний отрыв —
-- 99 часов, четверо суток. В итоге 85 из 325 задач с отметкой «звонок» были
-- помечены так в день, когда по заказу никто не звонил.
--
-- Цена ошибки: вечерний отчёт показывал работу, которой в этот день не было, —
-- то есть врал в пользу менеджера. А наверх этим отчётом обосновывают, кому
-- можно поднять нагрузку.
--
-- Заодно приоритет видов касания задан явно. Раньше вид выбирался через min()
-- по алфавиту: «звонок» оказывался впереди «комментария» по чистой случайности
-- русской азбуки, а «письмо» проигрывало «комментарию» — хотя письмо это
-- внешний след работы, а комментарий только запись о ней.

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
        -- Ключевая правка: started_at — когда РАЗГОВАРИВАЛИ, а не matched_at —
        -- когда наша система об этом узнала.
        SELECT m.retailcrm_order_id, 'звонок'
          FROM public.call_order_matches m
          JOIN public.raw_telphin_calls rc ON rc.telphin_call_id = m.telphin_call_id
         WHERE rc.started_at >= p_date::timestamptz
           AND rc.started_at < (p_date + 1)::timestamptz
      ) t
     WHERE t.order_id IS NOT NULL
     GROUP BY t.order_id;
$function$;
