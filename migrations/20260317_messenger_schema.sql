-- Migration: Corporate Messenger Schema
-- Created: 2026-03-17

-- 1. CHATS Table
CREATE TABLE IF NOT EXISTS public.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('direct', 'group')),
    name TEXT, -- Null for direct chats
    context_order_id BIGINT REFERENCES public.orders(order_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. CHAT_PARTICIPANTS Table
CREATE TABLE IF NOT EXISTS public.chat_participants (
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES public.managers(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    last_read_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);

-- 3. MESSAGES Table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE NOT NULL,
    sender_id BIGINT REFERENCES public.managers(id) ON DELETE SET NULL, -- Null for system bots
    content TEXT,
    attachments JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Enable Row Level Security
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for CHATS
-- Users can see chats they are participants in
CREATE POLICY "Users can see chats they are participants in"
    ON public.chats
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.chat_participants
            WHERE chat_participants.chat_id = chats.id
            AND chat_participants.user_id = (auth.jwt() ->> 'retail_crm_manager_id')::bigint
        )
        OR (auth.role() = 'service_role')
    );

-- 6. RLS Policies for CHAT_PARTICIPANTS
CREATE POLICY "Users can see participants of their chats"
    ON public.chat_participants
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.chat_participants AS cp
            WHERE cp.chat_id = chat_participants.chat_id
            AND cp.user_id = (auth.jwt() ->> 'retail_crm_manager_id')::bigint
        )
        OR (auth.role() = 'service_role')
    );

-- 7. RLS Policies for MESSAGES
CREATE POLICY "Users can see messages in their chats"
    ON public.messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.chat_participants
            WHERE chat_participants.chat_id = messages.chat_id
            AND chat_participants.user_id = (auth.jwt() ->> 'retail_crm_manager_id')::bigint
        )
        OR (auth.role() = 'service_role')
    );

CREATE POLICY "Users can insert messages in their chats"
    ON public.messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.chat_participants
            WHERE chat_participants.chat_id = messages.chat_id
            AND chat_participants.user_id = (auth.jwt() ->> 'retail_crm_manager_id')::bigint
        )
        OR (auth.role() = 'service_role')
    );

-- 8. Realtime (Enable replication for messages)
-- Note: This is usually done via Supabase dashboard or a specific SQL command
-- depending on the Supabase version. For PostgreSQL 15+:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- 9. Automatic Updated At trigger for chats
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_chats_updated_at
    BEFORE UPDATE ON public.chats
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON public.messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON public.chat_participants(user_id);
