
-- Add is_ai_target column to status_settings
ALTER TABLE status_settings ADD COLUMN IF NOT EXISTS is_ai_target BOOLEAN DEFAULT false;

-- Optional: Initialize it based on current requirements
-- This will set it to true for all active "working" statuses and all cancelled statuses
UPDATE status_settings ss
SET is_ai_target = true
FROM statuses s
WHERE ss.code = s.code
AND (ss.is_working = true OR s.group_name ILIKE '%Отменен%');

-- Also insert missing entries from the "Отменен" group that might not be in status_settings yet
INSERT INTO status_settings (code, is_working, is_transcribable, is_ai_target, updated_at)
SELECT code, false, false, true, NOW()
FROM statuses
WHERE group_name ILIKE '%Отменен%'
ON CONFLICT (code) DO UPDATE 
SET is_ai_target = true;
