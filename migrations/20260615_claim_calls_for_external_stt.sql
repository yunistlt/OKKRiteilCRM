-- «Перевёрнутая» транскрибация: STT-сервер (в РФ, Timeweb) сам забирает задачи и пишет результат,
-- т.к. геоблок не пускает Vercel (за рубежом) внутрь России. Функция атомарно выдаёт внешнему
-- воркеру пачку звонков, ждущих расшифровки, и помечает их 'submitted' (лиз stt_submitted_at).
-- Кандидаты: есть запись, нет транскрипта, статус null/pending/ready/failed ИЛИ протухший 'submitted'
-- (воркер взял и упал >30 мин назад → переотдаём). FOR UPDATE SKIP LOCKED — безопасно при параллели.
-- Свежие звонки вперёд (ORDER BY started_at DESC), бэклог подбирается следом.

CREATE OR REPLACE FUNCTION claim_calls_for_external_stt(p_limit int DEFAULT 1)
RETURNS TABLE(call_id text, recording_url text, duration_sec int)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    UPDATE raw_telphin_calls r
    SET transcription_status = 'submitted', stt_submitted_at = now()
    WHERE r.telphin_call_id IN (
        SELECT c.telphin_call_id
        FROM raw_telphin_calls c
        WHERE c.recording_url IS NOT NULL
          AND c.transcript IS NULL
          AND (
              c.transcription_status IS NULL
              OR c.transcription_status IN ('pending', 'ready_for_transcription', 'failed')
              OR (c.transcription_status = 'submitted'
                  AND (c.stt_submitted_at IS NULL OR c.stt_submitted_at < now() - interval '30 minutes'))
          )
          -- Только звонки, чей заказ в статусе, помеченном для транскрибации (status_settings.is_transcribable).
          -- Настраивается в UI «Настройка ОКК» → колонка ТРАНСКРИБАЦИЯ. Читается живьём.
          AND EXISTS (
              SELECT 1
              FROM call_order_matches m
              JOIN orders o ON o.id::text = m.retailcrm_order_id::text
              JOIN status_settings ss ON ss.code = o.status
              WHERE m.telphin_call_id = c.telphin_call_id
                AND ss.is_transcribable = true
          )
        ORDER BY c.started_at DESC
        LIMIT GREATEST(p_limit, 1)
        FOR UPDATE SKIP LOCKED
    )
    RETURNING r.telphin_call_id, r.recording_url, r.duration_sec;
END;
$$;
