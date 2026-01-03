-- Create a separate table for user configurations
CREATE TABLE IF NOT EXISTS status_settings (
    code text PRIMARY KEY REFERENCES statuses(code) ON DELETE CASCADE,
    is_working boolean DEFAULT false,
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE status_settings ENABLE ROW LEVEL SECURITY;

-- Policies (Open access as requested for this internal tool)
CREATE POLICY "Allow public full access" ON status_settings USING (true) WITH CHECK (true);

-- Permissions
GRANT ALL ON status_settings TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload config';
