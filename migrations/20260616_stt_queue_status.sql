-- Статус очереди транскрибации для watchdog-алерта «STT-воркер встал/ползёт».
-- Возвращает:
--   last_activity   — время последней claim-активности (max stt_submitted_at);
--   waiting         — сколько звонков ждут расшифровки (фильтр claim: транскрибируемый статус заказа);
--   done_last_hour  — сколько ВОРКЕР обработал за час (completed ИЛИ failed) = любая активность/прогресс.
-- Алерт: есть бэклог (waiting большой), но прогресс почти нулевой (done_last_hour мал) → воркер не тянет.

DROP FUNCTION IF EXISTS stt_queue_status();
CREATE OR REPLACE FUNCTION stt_queue_status()
RETURNS TABLE(last_activity timestamptz, waiting int, done_last_hour int)
LANGUAGE sql STABLE AS $$
    SELECT
        (SELECT max(stt_submitted_at) FROM raw_telphin_calls) AS last_activity,
        (SELECT count(DISTINCT r.telphin_call_id)::int
         FROM raw_telphin_calls r
         JOIN call_order_matches m ON m.telphin_call_id = r.telphin_call_id
         JOIN orders o ON o.id::text = m.retailcrm_order_id::text
         JOIN status_settings ss ON ss.code = o.status AND ss.is_transcribable = true
         WHERE r.recording_url IS NOT NULL
           AND r.transcript IS NULL
           AND (r.transcription_status IS NULL
                OR r.transcription_status IN ('pending', 'ready_for_transcription', 'failed')
                OR (r.transcription_status = 'submitted'
                    AND (r.stt_submitted_at IS NULL OR r.stt_submitted_at < now() - interval '30 minutes')))
        ) AS waiting,
        (SELECT count(*)::int FROM raw_telphin_calls
         WHERE transcription_status IN ('completed', 'failed')
           AND stt_submitted_at > now() - interval '1 hour'
        ) AS done_last_hour;
$$;
