-- Add AMD columns to calls table
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_answering_machine boolean;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS am_detection_result jsonb;

-- Recommended: index for filtering
CREATE INDEX IF NOT EXISTS idx_calls_is_answering_machine ON calls(is_answering_machine) WHERE is_answering_machine IS NOT NULL;
