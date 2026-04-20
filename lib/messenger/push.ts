import webpush from 'web-push';
import { isMissingMessengerRelationError } from '@/lib/messenger/error';
import { logMessengerError } from '@/lib/messenger/logger';
import { loadManagerUsernames } from '@/lib/messenger/manager-usernames';
import { supabase } from '@/utils/supabase';

type PushSubscriptionRow = {
    endpoint: string;
    p256dh: string;
    auth: string;
    user_id: number;
    platform: string | null;
    browser: string | null;
    device_label: string | null;
    last_seen_at: string | null;
    settings: Record<string, unknown> | null;
    chat_scope: Record<string, unknown> | null;
};

type SubscriptionSettings = {
    enabled?: boolean;
    delivery_mode?: 'all' | 'direct_only' | 'mentions_only';
    preview_mode?: 'full' | 'safe' | 'hidden';
    muted_chat_ids?: string[];
};

type PushPresenceRow = {
    endpoint: string;
    user_id: number;
    chat_id: string | null;
};

type ChatParticipantRow = {
    user_id: number;
    managers: {
        first_name: string | null;
        last_name: string | null;
    } | null;
};

type ChatRow = {
    id: string;
    type: 'direct' | 'group';
    name: string | null;
};

type DispatchMessageRow = {
    id: string;
    chat_id: string;
    sender_id: number | null;
    content: string | null;
    attachments: Array<{ name?: string; type?: string }> | null;
    created_at: string;
};

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:ops@okkriteilcrm.local';
const ACTIVE_PRESENCE_TTL_MS = 90_000;
const PUSH_RUNTIME_TABLES = [
    'messenger_push_subscriptions',
    'messenger_push_presence',
    'messenger_push_delivery_logs',
];

let vapidConfigured = false;

function ensureVapidConfigured() {
    if (vapidConfigured) {
        return true;
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return false;
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    return true;
}

function normalizePreview(message: DispatchMessageRow) {
    const trimmedContent = message.content?.trim();
    if (trimmedContent) {
        return trimmedContent.length > 140 ? `${trimmedContent.slice(0, 137)}...` : trimmedContent;
    }

    if (message.attachments && message.attachments.length > 0) {
        const attachmentName = message.attachments[0]?.name || 'вложение';
        return `Отправил вложение: ${attachmentName}`;
    }

    return 'Новое сообщение';
}

function getSubscriptionSettings(subscription: PushSubscriptionRow): SubscriptionSettings {
    return (subscription.settings || {}) as SubscriptionSettings;
}

function isSubscriptionMuted(subscription: PushSubscriptionRow, chatId: string) {
    const settings = getSubscriptionSettings(subscription);
    if (settings.enabled === false) {
        return true;
    }

    const mutedChatIds = Array.isArray(settings.muted_chat_ids)
        ? settings.muted_chat_ids.filter((value): value is string => typeof value === 'string')
        : [];

    return mutedChatIds.includes(chatId);
}

function shouldSendByDeliveryMode(params: {
    subscription: PushSubscriptionRow;
    chat: ChatRow | null;
    recipientUsername?: string | null;
    message: DispatchMessageRow;
}) {
    const settings = getSubscriptionSettings(params.subscription);
    const deliveryMode = settings.delivery_mode || 'all';

    if (deliveryMode === 'all') {
        return true;
    }

    if (deliveryMode === 'direct_only') {
        return params.chat?.type === 'direct';
    }

    if (params.chat?.type === 'direct') {
        return false;
    }

    const username = params.recipientUsername?.trim();
    if (!username) {
        return false;
    }

    return (params.message.content || '').toLowerCase().includes(`@${username.toLowerCase()}`);
}

function buildNotificationBody(subscription: PushSubscriptionRow, message: DispatchMessageRow, senderName: string) {
    const settings = getSubscriptionSettings(subscription);
    const previewMode = settings.preview_mode || 'full';

    if (previewMode === 'hidden') {
        return 'Новое сообщение в корпоративном мессенджере';
    }

    if (previewMode === 'safe') {
        return `Новое сообщение от ${senderName}`;
    }

    return normalizePreview(message);
}

async function logDelivery(params: {
    messageId: string;
    chatId: string;
    recipientUserId: number;
    endpoint: string | null;
    status: string;
    payload: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
}) {
    const { error } = await supabase
        .from('messenger_push_delivery_logs')
        .insert({
            message_id: params.messageId,
            chat_id: params.chatId,
            recipient_user_id: params.recipientUserId,
            endpoint: params.endpoint,
            status: params.status,
            error_code: params.errorCode || null,
            error_message: params.errorMessage || null,
            payload: params.payload,
        });

    if (error) {
        if (isMissingMessengerRelationError(error, 'messenger_push_delivery_logs')) {
            return;
        }

        logMessengerError('push.dispatch', error, {
            chatId: params.chatId,
            messageId: params.messageId,
            userId: params.recipientUserId,
            details: { stage: 'delivery_audit' },
        });
    }
}

async function revokeSubscription(endpoint: string) {
    const now = new Date().toISOString();
    await supabase
        .from('messenger_push_subscriptions')
        .update({ revoked_at: now, updated_at: now, permission_state: 'default' })
        .eq('endpoint', endpoint);
}

export async function dispatchMessengerPushNotifications(params: {
    message: DispatchMessageRow;
}) {
    try {
        const { message } = params;

        if (!message.sender_id) {
            return { delivered: 0, skipped: 0, reason: 'system_message' };
        }

        if (!ensureVapidConfigured()) {
            return { delivered: 0, skipped: 0, reason: 'vapid_not_configured' };
        }

        const [{ data: chatParticipants, error: participantsError }, { data: chat, error: chatError }] = await Promise.all([
            supabase
                .from('chat_participants')
                .select(`
                    user_id,
                    managers (
                        first_name,
                        last_name
                    )
                `)
                .eq('chat_id', message.chat_id),
            supabase
                .from('chats')
                .select('id, type, name')
                .eq('id', message.chat_id)
                .maybeSingle(),
        ]);

        if (participantsError) throw participantsError;
        if (chatError) throw chatError;

        const typedChatParticipants = (chatParticipants || []) as ChatParticipantRow[];
        const typedChat = (chat || null) as ChatRow | null;
        const usernamesByManagerId = await loadManagerUsernames(typedChatParticipants.map((participant) => participant.user_id));

        const sender = typedChatParticipants.find((participant) => participant.user_id === message.sender_id);
        const participantByUserId = new Map(typedChatParticipants.map((participant) => [participant.user_id, participant]));
        const senderName = `${sender?.managers?.first_name || ''} ${sender?.managers?.last_name || ''}`.trim()
            || usernamesByManagerId.get(message.sender_id)
            || `Сотрудник ${message.sender_id}`;

        const recipientIds = typedChatParticipants
            .map((participant) => participant.user_id)
            .filter((userId) => userId !== message.sender_id);

        if (recipientIds.length === 0) {
            return { delivered: 0, skipped: 0, reason: 'no_recipients' };
        }

        const { data: subscriptions, error: subscriptionsError } = await supabase
            .from('messenger_push_subscriptions')
            .select('endpoint, p256dh, auth, user_id, platform, browser, device_label, last_seen_at, settings, chat_scope')
            .in('user_id', recipientIds)
            .is('revoked_at', null)
            .eq('permission_state', 'granted');

        if (subscriptionsError) throw subscriptionsError;

        const typedSubscriptions = (subscriptions || []) as PushSubscriptionRow[];

        if (typedSubscriptions.length === 0) {
            return { delivered: 0, skipped: 0, reason: 'no_subscriptions' };
        }

        const activeSince = new Date(Date.now() - ACTIVE_PRESENCE_TTL_MS).toISOString();
        const subscriptionEndpoints = typedSubscriptions.map((subscription) => subscription.endpoint);

        const { data: activePresence, error: activePresenceError } = await supabase
            .from('messenger_push_presence')
            .select('endpoint, user_id, chat_id')
            .in('endpoint', subscriptionEndpoints)
            .eq('page_visible', true)
            .eq('focused', true)
            .gte('last_seen_at', activeSince);

        if (activePresenceError) throw activePresenceError;

        const activePresenceRows = (activePresence || []) as PushPresenceRow[];
        const activeEndpointsInCurrentChat = new Set(
            activePresenceRows
                .filter((entry) => entry.chat_id === message.chat_id)
                .map((entry) => entry.endpoint)
        );

        const title = typedChat?.type === 'group'
            ? `${senderName} написал в «${typedChat?.name || 'Группа'}»`
            : `${senderName} написал вам`;
        let delivered = 0;
        let skipped = 0;

        await Promise.allSettled(typedSubscriptions.map(async (subscription) => {
            const recipient = participantByUserId.get(subscription.user_id);
            const recipientUsername = usernamesByManagerId.get(subscription.user_id) || null;
            const body = buildNotificationBody(subscription, message, senderName);
            const payload = {
                title,
                body,
                chat_id: message.chat_id,
                message_id: message.id,
                sender_name: senderName,
                preview: body,
                click_action: `/messenger?chat_id=${encodeURIComponent(message.chat_id)}&message_id=${encodeURIComponent(message.id)}`,
            };

            if (activeEndpointsInCurrentChat.has(subscription.endpoint)) {
                skipped += 1;
                await logDelivery({
                    messageId: message.id,
                    chatId: message.chat_id,
                    recipientUserId: subscription.user_id,
                    endpoint: subscription.endpoint,
                    status: 'skipped_active_chat_endpoint',
                    payload,
                });
                return;
            }

            if (isSubscriptionMuted(subscription, message.chat_id)) {
                skipped += 1;
                await logDelivery({
                    messageId: message.id,
                    chatId: message.chat_id,
                    recipientUserId: subscription.user_id,
                    endpoint: subscription.endpoint,
                    status: 'skipped_muted',
                    payload,
                });
                return;
            }

            if (!shouldSendByDeliveryMode({ subscription, chat: chat || null, recipientUsername, message })) {
                skipped += 1;
                await logDelivery({
                    messageId: message.id,
                    chatId: message.chat_id,
                    recipientUserId: subscription.user_id,
                    endpoint: subscription.endpoint,
                    status: 'skipped_delivery_mode',
                    payload,
                });
                return;
            }

            try {
                await webpush.sendNotification(
                    {
                        endpoint: subscription.endpoint,
                        keys: {
                            p256dh: subscription.p256dh,
                            auth: subscription.auth,
                        },
                    },
                    JSON.stringify(payload),
                );

                delivered += 1;
                await logDelivery({
                    messageId: message.id,
                    chatId: message.chat_id,
                    recipientUserId: subscription.user_id,
                    endpoint: subscription.endpoint,
                    status: 'sent',
                    payload,
                });
            } catch (error: unknown) {
                const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
                    ? String((error as { statusCode?: number }).statusCode)
                    : undefined;
                const errorMessage = error instanceof Error ? error.message : String(error);

                if (statusCode === '404' || statusCode === '410') {
                    await revokeSubscription(subscription.endpoint);
                }

                await logDelivery({
                    messageId: message.id,
                    chatId: message.chat_id,
                    recipientUserId: subscription.user_id,
                    endpoint: subscription.endpoint,
                    status: 'failed',
                    payload,
                    errorCode: statusCode,
                    errorMessage,
                });

                logMessengerError('push.dispatch', error, {
                    chatId: message.chat_id,
                    messageId: message.id,
                    userId: subscription.user_id,
                    details: {
                        endpoint: subscription.endpoint,
                        statusCode,
                    },
                });
            }
        }));

        return { delivered, skipped, reason: 'completed' };
    } catch (error: unknown) {
        if (isMissingMessengerRelationError(error, PUSH_RUNTIME_TABLES)) {
            return { delivered: 0, skipped: 0, reason: 'push_tables_missing' };
        }

        throw error;
    }
}