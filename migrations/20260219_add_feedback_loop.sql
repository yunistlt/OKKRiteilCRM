-- Add feedback loop columns to okk_violations
-- This allows the Controller (human) to validate AI judgments

ALTER TABLE okk_violations
ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending', -- pending, confirmed, rejected
ADD COLUMN IF NOT EXISTS controller_comment text, -- Human explanation
ADD COLUMN IF NOT EXISTS confidence numeric; -- AI confidence score (0.0 - 1.0)

-- Add constraint to ensure valid status
ALTER TABLE okk_violations
DROP CONSTRAINT IF EXISTS okk_violations_status_check;

ALTER TABLE okk_violations
ADD CONSTRAINT okk_violations_status_check 
CHECK (status IN ('pending', 'confirmed', 'rejected'));

-- Comment for documentation
COMMENT ON COLUMN okk_violations.status IS 'Validation status: pending (AI only), confirmed (Human agreed), rejected (Human disagreed)';
