create table if not exists managers (
  id int8 primary key,
  first_name text,
  last_name text,
  email text,
  active boolean,
  telphin_extension text,
  raw_data jsonb,
  created_at timestamp with time zone default now()
);
NOTIFY pgrst, 'reload config';
