-- Add notify_telegram column to okk_rules table
ALTER TABLE public.okk_rules 
ADD COLUMN IF NOT EXISTS notify_telegram BOOLEAN DEFAULT false;

-- Comment for clarity
COMMENT ON COLUMN public.okk_rules.notify_telegram IS 'If true, send Telegram notification on violation';
