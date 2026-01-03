-- Create order_priorities table for caching Traffic Light analysis
create table if not exists order_priorities (
    order_id bigint primary key references orders(id) on delete cascade,
    level text not null check (level in ('red', 'yellow', 'green', 'black')),
    score integer not null default 0,
    reasons jsonb default '[]'::jsonb,
    summary text,
    recommended_action text,
    updated_at timestamptz default now()
);

-- Index for fast status filtering
create index if not exists idx_order_priorities_level on order_priorities(level);

-- Helper to update updated_at
create extension if not exists moddatetime;
create trigger handle_updated_at before update on order_priorities
  for each row execute procedure moddatetime (updated_at);
