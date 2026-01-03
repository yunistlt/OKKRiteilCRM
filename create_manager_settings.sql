-- Create a separate table for manager configurations (Who to include in reports)
CREATE TABLE IF NOT EXISTS manager_settings (
    id int8 PRIMARY KEY REFERENCES managers(id) ON DELETE CASCADE,
    is_controlled boolean DEFAULT false,
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE manager_settings ENABLE ROW LEVEL SECURITY;

-- Policies (Open access as requested for this internal tool)
CREATE POLICY "Allow public full access" ON manager_settings USING (true) WITH CHECK (true);

-- Permissions
GRANT ALL ON manager_settings TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload config';
