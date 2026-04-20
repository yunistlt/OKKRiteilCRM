export interface MessengerManagerSummary {
    id?: number;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
}

export interface MessengerParticipant {
    user_id: number;
    role?: string;
    last_read_at?: string | null;
    joined_at?: string;
    managers?: MessengerManagerSummary | null;
}

export interface MessengerAttachment {
    name?: string;
    path?: string;
    type?: string;
    size?: number;
}

export interface MessengerMessage {
    id: string;
    local_id?: string;
    sender_id: number | null;
    content: string | null;
    attachments?: MessengerAttachment[];
    created_at: string;
    _status?: 'sending' | 'failed';
}

export interface MessengerOrderContext {
    order_id?: number;
    number?: string | null;
    status?: string | null;
    retailcrm_url?: string;
}

export interface MessengerChat {
    id: string;
    type: 'direct' | 'group';
    name: string | null;
    context_order_id?: number | null;
    context_order?: MessengerOrderContext | null;
    chat_participants?: MessengerParticipant[];
    last_message?: Pick<MessengerMessage, 'content' | 'created_at' | 'sender_id'> | null;
    unread_count?: number;
}

export interface MessengerPushSubscriptionSettings {
    enabled?: boolean;
    delivery_mode?: 'all' | 'direct_only' | 'mentions_only';
    preview_mode?: 'full' | 'safe' | 'hidden';
    muted_chat_ids?: string[];
}

export interface MessengerPushSubscriptionSummary {
    endpoint: string;
    platform?: string | null;
    browser?: string | null;
    device_label?: string | null;
    permission_state?: string | null;
    last_seen_at?: string | null;
    settings?: MessengerPushSubscriptionSettings | null;
}