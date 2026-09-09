-- ============================================================================
-- Выдача звонков внешнему STT-воркеру: снимаем мёртвый фильтр и добавляем
-- ночной разбор хвоста.
--
-- Что было не так. claim_calls_for_external_stt отдавал только звонки,
-- сматченные с заказом, чей ТЕКУЩИЙ статус помечен status_settings.is_transcribable.
-- Статус — величина временная: заказ уехал в производство или в отмену, и звонок
-- выпадал из выборки навсегда. На 02.09.2026 в очереди 5 613 звонков с записью,
-- из них воркеру доступно 0 — очередь стояла не из-за скорости сервера, а потому
-- что выборка пустая. Плюс 2 607 звонков вообще не сматчены с заказом (матчинг
-- ошибается), и такой звонок не расшифровывался никогда.
--
-- Что теперь. Пул — все звонки с записью длиннее порога. Пометка
-- is_transcribable из «допуска» становится ПРИОРИТЕТОМ: такие звонки уходят
-- на расшифровку первыми, остальные — следом. Ничего не теряется, настройка
-- в «Настройке ОКК» продолжает работать, но больше не запирает очередь.
--
-- Ночной разбор хвоста: p_backlog = true меняет порядок на «сначала самые
-- старые» и берёт только звонки старше p_backlog_age_hours. Днём воркер
-- получает свежие разговоры (они нужны ОКК и боту-РОПу сегодня), ночью тот же
-- воркер догрызает исторический хвост, не мешая свежим.
--
-- Порог длительности — из sync_state.transcription_min_duration (тот же ключ,
-- что читает код, getTranscriptionMinDuration), а не число в SQL.
-- Аддитивно: новые параметры со значениями по умолчанию, старые вызовы живут.
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_calls_for_external_stt(integer);
DROP FUNCTION IF EXISTS public.claim_calls_for_external_stt(integer, boolean, integer);

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
BEGIN
    SELECT COALESCE(NULLIF(regexp_replace(value, '\D', '', 'g'), '')::int, 15)
      INTO v_min_duration
      FROM sync_state
     WHERE key = 'transcription_min_duration';
    v_min_duration := COALESCE(v_min_duration, 15);

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
          -- Ночной проход берёт только отстоявшийся хвост, чтобы не конкурировать
          -- со свежими разговорами, если воркер запущен в обоих режимах.
          AND (NOT p_backlog OR c.started_at < now() - make_interval(hours => GREATEST(p_backlog_age_hours, 0)))
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
