create table if not exists public.messenger_push_presence (
    id uuid primary key default gen_random_uuid(),
    endpoint text not null references public.messenger_push_subscriptions(endpoint) on delete cascade,
    tab_id text not null,
    user_id bigint not null references public.managers(id) on delete cascade,
    chat_id uuid null references public.chats(id) on delete cascade,
    page_path text,
    page_visible boolean not null default true,
    focused boolean not null default true,
    last_seen_at timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique(endpoint, tab_id)
);

create index if not exists idx_messenger_push_presence_active
    on public.messenger_push_presence(endpoint, chat_id, page_visible, focused, last_seen_at desc);

create table if not exists public.messenger_push_delivery_logs (
    id uuid primary key default gen_random_uuid(),
    message_id uuid references public.messages(id) on delete cascade,
    chat_id uuid not null references public.chats(id) on delete cascade,
    recipient_user_id bigint not null references public.managers(id) on delete cascade,
    endpoint text,
    status text not null,
    provider text not null default 'web-push',
    error_code text,
    error_message text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_messenger_push_delivery_logs_message
    on public.messenger_push_delivery_logs(message_id, created_at desc);

create index if not exists idx_messenger_push_delivery_logs_recipient
    on public.messenger_push_delivery_logs(recipient_user_id, created_at desc);