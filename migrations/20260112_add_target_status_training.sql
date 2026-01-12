
-- Add target_status column to training_examples to support routing training
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'training_examples'
        AND column_name = 'target_status'
    ) THEN
        ALTER TABLE training_examples ADD COLUMN target_status text;
    END IF;
END $$;
