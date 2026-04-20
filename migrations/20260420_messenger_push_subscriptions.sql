create table if not exists public.messenger_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id bigint not null references public.managers(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    subscription jsonb not null,
    platform text,
    browser text,
    device_label text,
    user_agent text,
    chat_scope jsonb not null default '{}'::jsonb,
    settings jsonb not null default '{}'::jsonb,
    permission_state text not null default 'granted',
    last_seen_at timestamptz not null default timezone('utc', now()),
    revoked_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_messenger_push_subscriptions_user_id
    on public.messenger_push_subscriptions(user_id);

create index if not exists idx_messenger_push_subscriptions_active
    on public.messenger_push_subscriptions(user_id, revoked_at, last_seen_at desc);