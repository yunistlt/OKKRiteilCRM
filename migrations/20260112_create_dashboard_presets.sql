create table if not exists dashboard_presets (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  filters jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS (optional but good practice, though we might keep it open for now for internal tool simplicity)
alter table dashboard_presets enable row level security;

-- Policy: Allow all access for authenticated users (or public if no auth yet for this internal tool)
create policy "Allow all access" on dashboard_presets for all using (true) with check (true);
