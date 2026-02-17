-- Add 'checklist' column to 'okk_rules' table to store Quality Control regulations
-- The structure will be:
-- [
--   {
--     "section": "Приветствие",
--     "items": [
--       { "description": "Представиться", "weight": 10 },
--       { "description": "Назвать компанию", "weight": 10 }
--     ]
--   }
-- ]

ALTER TABLE okk_rules 
ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN okk_rules.checklist IS 'Stores structured regulation checklist for Quality Control rules';
