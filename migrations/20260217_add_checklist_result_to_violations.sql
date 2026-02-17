-- Add checklist_result column to okk_violations to store detailed audit results
ALTER TABLE okk_violations
ADD COLUMN checklist_result JSONB;

COMMENT ON COLUMN okk_violations.checklist_result IS 'Stores the full JSON result of the Quality Control audit (score, sections, breakdown)';
