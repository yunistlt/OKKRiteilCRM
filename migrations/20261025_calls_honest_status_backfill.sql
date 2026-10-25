-- Разовый разбор очереди расшифровки: вместо вечного «ждёт» — причина.
--
-- На 25.10.2026 в очереди висело 910 звонков, у всех до одного не было записи
-- (563 вообще без соединения, самые старые — с мая 2025). Расшифровать их
-- нельзя никогда, а счётчик «ждут расшифровки» из-за них ничего не значил.
--
-- Правило то же, что в коде (lib/telphin-call-outcome.ts): смотрим «ноги»
-- звонка из самого Телфина, а не длительность.
--   соединение было + записи нет → no_recording («Без записи»)
--   соединения не было          → no_answer    («Не дозвонились»)
-- Звонки с записью не трогаем: они законно ждут своей очереди.
UPDATE raw_telphin_calls c
SET transcription_status = CASE
        WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(c.raw_payload->'cdr') = 'array' THEN c.raw_payload->'cdr' ELSE '[]'::jsonb END
            ) leg
            WHERE lower(leg->>'result') = 'answered'
        ) THEN 'no_recording'
        ELSE 'no_answer'
    END
WHERE c.transcription_status = 'pending'
  AND c.transcript IS NULL
  AND (c.recording_url IS NULL OR c.recording_url = '')
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.raw_payload->'cdr') = 'array' THEN c.raw_payload->'cdr' ELSE '[]'::jsonb END
      ) leg
      WHERE leg->>'record_uuid' IS NOT NULL OR leg->>'storage_url' IS NOT NULL
  );
