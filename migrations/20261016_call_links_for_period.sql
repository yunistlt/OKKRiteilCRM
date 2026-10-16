-- Связи «звонок — заказ» за период, без перебора всей истории звонков.
--
-- То же, что call_order_links_for_day, но за диапазон: пересчёту показателей
-- менеджера нужны звонки за 35 дней, а не за сутки. Через представление
-- call_order_link эта выборка занимает 16,7 с (замер 16.10.2026) — больше
-- таймаута Supabase, поэтому 682 задания manager_aggregate_refresh падали по
-- кругу, жгли диск и не доводили ни одного пересчёта до конца.
--
-- Дедупликация «ног» звонка внутри диапазона корректна: все ноги одного
-- разговора лежат в одном дне, разговор не переходит через полночь в разные
-- сутки выборки.

CREATE OR REPLACE FUNCTION public.call_order_links_for_period(p_from timestamptz, p_to timestamptz)
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
    WITH za_period AS (
        SELECT DISTINCT ON (upper(t.telphin_call_id))
               t.telphin_call_id,
               upper(t.telphin_call_id) AS call_key,
               t.started_at,
               t.duration_sec,
               t.direction,
               NULLIF(t.raw_payload->>'manager_id', '')::bigint AS manager_id,
               t.record_uuids,
               (EXISTS (
                    SELECT 1 FROM jsonb_array_elements(COALESCE(t.raw_payload->'cdr', '[]'::jsonb)) c
                     WHERE COALESCE((c.value->>'duration')::integer, 0) > 0
                ) OR t.recording_url IS NOT NULL) AS answered
          FROM public.raw_telphin_calls t
         WHERE t.started_at >= p_from
           AND t.started_at < p_to
         ORDER BY upper(t.telphin_call_id),
                  COALESCE(t.duration_sec, 0) DESC,
                  (t.recording_url IS NOT NULL) DESC
    ),
    privyazka AS (
        SELECT DISTINCT ON (upper(m.telphin_call_id))
               upper(m.telphin_call_id) AS call_key,
               m.retailcrm_order_id AS order_id,
               m.match_type
          FROM public.call_order_matches m
         WHERE m.match_type <> 'ai_suggested'
           AND upper(m.telphin_call_id) IN (SELECT call_key FROM za_period)
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
    SELECT z.telphin_call_id, p.order_id, z.started_at, z.duration_sec, z.direction, z.manager_id,
           CASE
               WHEN p.match_type IN ('okk_card', 'manual', 'okk_auto') THEN 'own'
               WHEN p.match_type = 'retailcrm' THEN 'crm'
               ELSE 'match'
           END,
           p.match_type,
           z.answered
      FROM za_period z
      JOIN privyazka p ON p.call_key = z.call_key

    UNION ALL

    -- Звонки, привязанные к заказу в RetailCRM и не попавшие в наш матчинг.
    -- От RetailCRM отвязались, новых таких не появляется — ветка нужна только
    -- для дней до отвязки, которые ещё попадают в 35-дневное окно.
    SELECT z.telphin_call_id, o.order_id, z.started_at, z.duration_sec, z.direction,
           NULLIF(c.manager_rc_id, '')::bigint, 'crm', 'retailcrm', z.answered
      FROM za_period z
      JOIN public.retailcrm_calls c ON c.external_id = ANY (z.record_uuids)
      JOIN public.orders o ON o.number = c.order_number
     WHERE c.order_number IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.call_order_matches m
            WHERE upper(m.telphin_call_id) = z.call_key
              AND m.match_type <> 'ai_suggested'
       );
$function$;

-- Выборка за день теперь — частный случай периода, чтобы логика жила в одном месте.
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
    SELECT * FROM public.call_order_links_for_period(p_date::timestamptz, (p_date + 1)::timestamptz);
$function$;
