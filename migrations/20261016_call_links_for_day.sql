-- Связи «звонок — заказ» за один день, без перебора всей истории звонков.
--
-- Представление call_order_link отвечает на вопрос «какие звонки к каким заказам
-- относятся» по ВСЕЙ истории: читает все 60 тыс. звонков Телфина, в каждом
-- разбирает JSON с записями разговора, отбирает уникальные и соединяет с
-- привязками. Отфильтровать по дате раньше нельзя — уникальность считается по
-- всей таблице.
--
-- Но потребителям нужен один день. А все «ноги» одного звонка лежат в одном дне:
-- разговор не может начаться вчера и закончиться сегодня. Значит сначала берём
-- звонки за день, и уже среди них выбираем главную ногу — ответ тот же.
--
-- Замер на боевой базе 16.10.2026, день 15.10:
--   через call_order_link — 1 709 мс (на холодном кэше 7 600 мс), 18 заказов
--   этой функцией        —    75 мс,                             18 заказов
-- Списки заказов совпадают полностью.
--
-- Из-за старого пути «Мой день» собирался 9 секунд, падал пересчёт показателей
-- менеджеров (682 задания) и не собирались касания в утреннем отчёте РОПа.

CREATE OR REPLACE FUNCTION public.call_order_links_for_day(p_date date)
RETURNS TABLE(
    telphin_call_id text,
    order_id        bigint,
    started_at      timestamptz,
    duration_sec    integer,
    direction       text,
    manager_id      bigint,
    source          text,
    match_type      text,
    answered        boolean
)
LANGUAGE sql
STABLE
AS $function$
    WITH za_den AS (
        -- Одна строка на разговор: у звонка на отдел несколько «ног», берём ту,
        -- где говорили дольше и есть запись. Порядок тот же, что в call_order_link.
        SELECT DISTINCT ON (upper(t.telphin_call_id))
               t.telphin_call_id,
               upper(t.telphin_call_id) AS call_key,
               t.started_at,
               t.duration_sec,
               t.direction,
               NULLIF(t.raw_payload->>'manager_id', '')::bigint AS manager_id,
               t.record_uuids,
               -- Разговор состоялся: есть ненулевая длительность в записях CDR
               -- либо сохранилась запись разговора.
               (EXISTS (
                    SELECT 1 FROM jsonb_array_elements(COALESCE(t.raw_payload->'cdr', '[]'::jsonb)) c
                     WHERE COALESCE((c.value->>'duration')::integer, 0) > 0
                ) OR t.recording_url IS NOT NULL) AS answered
          FROM public.raw_telphin_calls t
         WHERE t.started_at >= p_date::timestamptz
           AND t.started_at < (p_date + 1)::timestamptz
         ORDER BY upper(t.telphin_call_id),
                  COALESCE(t.duration_sec, 0) DESC,
                  (t.recording_url IS NOT NULL) DESC
    ),
    privyazka AS (
        -- Наша привязка. Приоритет источников тот же, что в представлении:
        -- карточка ОКК, руками, автоматика ОКК, затем привязка из CRM.
        SELECT DISTINCT ON (upper(m.telphin_call_id))
               upper(m.telphin_call_id) AS call_key,
               m.retailcrm_order_id AS order_id,
               m.match_type
          FROM public.call_order_matches m
         WHERE m.match_type <> 'ai_suggested'
           AND upper(m.telphin_call_id) IN (SELECT call_key FROM za_den)
         ORDER BY upper(m.telphin_call_id),
                  CASE m.match_type
                      WHEN 'okk_card' THEN 1
                      WHEN 'manual'   THEN 2
                      WHEN 'okk_auto' THEN 3
                      WHEN 'retailcrm' THEN 4
                      ELSE 9
                  END,
                  m.matched_at DESC
    )
    SELECT z.telphin_call_id,
           p.order_id,
           z.started_at,
           z.duration_sec,
           z.direction,
           z.manager_id,
           CASE
               WHEN p.match_type IN ('okk_card', 'manual', 'okk_auto') THEN 'own'
               WHEN p.match_type = 'retailcrm' THEN 'crm'
               ELSE 'match'
           END,
           p.match_type,
           z.answered
      FROM za_den z
      JOIN privyazka p ON p.call_key = z.call_key

    UNION ALL

    -- Вторая ветка представления: звонки, привязанные к заказу в RetailCRM и не
    -- попавшие в наш матчинг. RetailCRM — архив, новых таких не появляется, но
    -- за прошлые дни они нужны, иначе отчёты за те дни разойдутся.
    SELECT z.telphin_call_id,
           o.order_id,
           z.started_at,
           z.duration_sec,
           z.direction,
           NULLIF(c.manager_rc_id, '')::bigint,
           'crm',
           'retailcrm',
           z.answered
      FROM za_den z
      JOIN public.retailcrm_calls c ON c.external_id = ANY (z.record_uuids)
      JOIN public.orders o ON o.number = c.order_number
     WHERE c.order_number IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.call_order_matches m
            WHERE upper(m.telphin_call_id) = z.call_key
              AND m.match_type <> 'ai_suggested'
       );
$function$;

-- Касания по заказам за день: звонки берём новой функцией вместо представления.
-- Остальная логика не менялась.
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
