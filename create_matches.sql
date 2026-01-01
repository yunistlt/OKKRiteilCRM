create table matches (
  id uuid default gen_random_uuid() primary key,
  order_id int8 not null, -- Links to orders.order_id (CRM Order ID)
  event_id int8,          -- Links to orders.id (Specific Event, optional)
  call_id text not null,  -- Links to calls.id
  score numeric,
  created_at timestamp with time zone default now()
);
