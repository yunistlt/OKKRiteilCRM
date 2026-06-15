-- Async-режим транскрибации через STT-сервер: снимает лимит длины звонка (синхронное ожидание
-- упиралось в maxDuration функции Vercel 300с). Поток: submit → сохраняем stt_job_id → крон-поллер
-- забирает результат по id, когда готов.
-- Новый transcription_status: 'submitted' (аудио отправлено на STT, ждём результат по поллеру).
-- Аддитивно: только новые колонки.

ALTER TABLE raw_telphin_calls ADD COLUMN IF NOT EXISTS stt_job_id text;
ALTER TABLE raw_telphin_calls ADD COLUMN IF NOT EXISTS stt_submitted_at timestamptz;

-- Поллеру: быстро находить отправленные, но ещё не завершённые задачи.
CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_stt_pending
    ON raw_telphin_calls (stt_submitted_at)
    WHERE transcription_status = 'submitted' AND stt_job_id IS NOT NULL;
