-- Add color column to statuses table
ALTER TABLE statuses ADD COLUMN IF NOT EXISTS color text;
