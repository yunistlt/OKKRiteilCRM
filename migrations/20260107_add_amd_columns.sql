
-- Add columns for Answering Machine Detection to raw_telphin_calls
ALTER TABLE raw_telphin_calls ADD COLUMN IF NOT EXISTS is_answering_machine BOOLEAN;
ALTER TABLE raw_telphin_calls ADD COLUMN IF NOT EXISTS am_detection_result JSONB;

COMMENT ON COLUMN raw_telphin_calls.is_answering_machine IS 'True if AI thinks this is an answering machine/Carrier message';
COMMENT ON COLUMN raw_telphin_calls.am_detection_result IS 'Detailed AI reasoning for AMD classification';
