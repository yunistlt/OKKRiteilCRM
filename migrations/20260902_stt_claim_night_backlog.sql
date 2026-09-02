-- ============================================================================
-- Хвост разбираем ТОЛЬКО ночью (уточнение к 20260902_stt_claim_backlog.sql).
--
-- Архивные звонки нужны не для сегодняшней работы, а для последующего анализа,
-- поэтому днём STT-сервер занимается только свежими разговорами (их ждут ОКК и
-- бот-РОП), а хвост берёт в ночном окне. Раньше режим 'fresh' лишь менял порядок
-- сортировки и, разобрав свежие, продолжал грызть хвост — днём сервер был занят
-- архивом, и срочный звонок вставал за ним в очередь.
--
-- Теперь граница жёсткая и симметричная по p_backlog_age_hours:
--   p_backlog = false (день) → только звонки МОЛОЖЕ порога, самые свежие первыми;
--   p_backlog = true  (ночь) → только звонки СТАРШЕ порога, самые старые первыми.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_calls_for_external_stt(
    p_limit integer,
    p_backlog boolean DEFAULT false,
    p_backlog_age_hours integer DEFAULT 48
)
RETURNS TABLE(call_id text, recording_url text, duration_sec integer)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_min_duration integer;
    v_cutoff timestamptz;
BEGIN
    SELECT COALESCE(NULLIF(regexp_replace(value, '\D', '', 'g'), '')::int, 15)
      INTO v_min_duration
      FROM sync_state
     WHERE key = 'transcription_min_duration';
    v_min_duration := COALESCE(v_min_duration, 15);

    v_cutoff := now() - make_interval(hours => GREATEST(p_backlog_age_hours, 0));

    RETURN QUERY
    UPDATE raw_telphin_calls r
    SET transcription_status = 'submitted', stt_submitted_at = now()
    WHERE r.telphin_call_id IN (
        SELECT c.telphin_call_id
        FROM raw_telphin_calls c
        WHERE c.recording_url IS NOT NULL
          AND c.transcript IS NULL
          AND COALESCE(c.duration_sec, 0) >= v_min_duration
          AND (
              c.transcription_status IS NULL
              OR c.transcription_status IN ('pending', 'ready_for_transcription', 'failed')
              OR (c.transcription_status = 'submitted'
                  AND (c.stt_submitted_at IS NULL OR c.stt_submitted_at < now() - interval '30 minutes'))
          )
          AND (CASE WHEN p_backlog THEN c.started_at < v_cutoff ELSE c.started_at >= v_cutoff END)
        ORDER BY
            -- Статус заказа помечен «транскрибировать» → в первую очередь.
            (EXISTS (
                SELECT 1
                FROM call_order_matches m
                JOIN orders o ON o.id::text = m.retailcrm_order_id::text
                JOIN status_settings ss ON ss.code = o.status
                WHERE m.telphin_call_id = c.telphin_call_id
                  AND ss.is_transcribable = true
            )) DESC,
            CASE WHEN p_backlog THEN c.started_at END ASC NULLS LAST,
            c.started_at DESC
        LIMIT GREATEST(p_limit, 1)
        FOR UPDATE SKIP LOCKED
    )
    RETURNING r.telphin_call_id, r.recording_url, r.duration_sec;
END;
$function$;
