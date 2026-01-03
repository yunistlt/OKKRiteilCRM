-- Allow public (anon) users to UPDATE statuses (required for toggling checkboxes)
CREATE POLICY "Allow public update" ON statuses FOR UPDATE USING (true);

-- Reload configuration to apply changes immediately
NOTIFY pgrst, 'reload config';
