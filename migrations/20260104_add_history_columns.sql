
-- Add missing columns for History Sync
ALTER TABLE public.raw_order_events 
ADD COLUMN IF NOT EXISTS field_name TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS old_value TEXT,
ADD COLUMN IF NOT EXISTS new_value TEXT;

-- We need a specific Unique Index for the UPSERT to work correctly
-- The code uses: onConflict: 'retailcrm_order_id, field_name, occurred_at'
-- So we must ensure this combination is unique.

-- First, drop conflicting constraints if any (the old unique constraint might strict us)
ALTER TABLE public.raw_order_events DROP CONSTRAINT IF EXISTS unique_order_event;

-- Create the new unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_order_events_dedup 
ON public.raw_order_events (retailcrm_order_id, field_name, occurred_at);
