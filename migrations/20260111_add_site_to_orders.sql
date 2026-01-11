-- Add site column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS site TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_site ON orders(site);
