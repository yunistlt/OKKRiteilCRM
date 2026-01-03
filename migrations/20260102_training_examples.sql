-- Create table for storing manual order evaluations (training examples)
create table if not exists training_examples (
    id serial primary key,
    order_id integer not null,
    order_number text not null,
    traffic_light text not null check (traffic_light in ('red', 'yellow', 'green')),
    user_reasoning text not null,
    order_context jsonb not null,
    created_at timestamptz default now(),
    created_by text
);

-- Indexes for performance
create index if not exists idx_training_examples_traffic on training_examples(traffic_light);
create index if not exists idx_training_examples_order on training_examples(order_id);
create index if not exists idx_training_examples_created on training_examples(created_at desc);

-- Comment
comment on table training_examples is 'Stores manual evaluations of orders for AI few-shot learning';
