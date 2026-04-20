-- Messenger performance indexes for chat membership and message history lookups

CREATE INDEX IF NOT EXISTS idx_chat_participants_chat_user
    ON public.chat_participants (chat_id, user_id);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created_at_desc
    ON public.messages (chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_chat_sender_created_at_desc
    ON public.messages (chat_id, sender_id, created_at DESC);