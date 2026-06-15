-- «Вторая наклейка» для звонков Telphin: храним все record_uuid звонка (по числу плеч в cdr)
-- в формате, который отдаёт RetailCRM в externalId ("<extId>-<record_uuid>", нижний регистр).
-- Это даёт прямую быструю стыковку retailcrm_calls.external_id ↔ raw_telphin_calls, НЕ трогая
-- существующий telphin_call_id (= call_uuid). Один звонок может иметь несколько плеч (≈25% строк),
-- поэтому колонка — массив.
-- Аддитивно: новая колонка + GIN-индекс + разовый бэкафилл из raw_payload.cdr[].record_uuid.

ALTER TABLE raw_telphin_calls ADD COLUMN IF NOT EXISTS record_uuids text[];

UPDATE raw_telphin_calls t
SET record_uuids = sub.arr
FROM (
    SELECT r.telphin_call_id,
           array_agg(DISTINCT lower(e->>'record_uuid')) AS arr
    FROM raw_telphin_calls r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.raw_payload->'cdr', '[]'::jsonb)) e
    WHERE e->>'record_uuid' IS NOT NULL
    GROUP BY r.telphin_call_id
) sub
WHERE t.telphin_call_id = sub.telphin_call_id
  AND t.record_uuids IS DISTINCT FROM sub.arr;

CREATE INDEX IF NOT EXISTS idx_raw_telphin_calls_record_uuids
    ON raw_telphin_calls USING gin (record_uuids);
