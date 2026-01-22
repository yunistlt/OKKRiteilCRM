
-- Allow condition_sql to be null since we are using 'logic' column now
ALTER TABLE okk_rules ALTER COLUMN condition_sql DROP NOT NULL;
