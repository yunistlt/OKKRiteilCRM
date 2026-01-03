-- Create statuses table
CREATE TABLE IF NOT EXISTS statuses (
    code text PRIMARY KEY,
    name text NOT NULL,
    is_working boolean DEFAULT false,
    ordering int DEFAULT 0,
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE statuses ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow public read" ON statuses FOR SELECT USING (true);
CREATE POLICY "Allow service_role full access" ON statuses USING (true) WITH CHECK (true);

-- Permissions
GRANT ALL ON statuses TO anon, authenticated, service_role;

-- Reload configuration to apply changes immediately
NOTIFY pgrst, 'reload config';
