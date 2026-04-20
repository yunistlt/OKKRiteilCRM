import { z } from 'zod';
import { supabase } from '@/utils/supabase';

export const MESSENGER_MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;
export const MESSENGER_MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

const allowedAttachmentMimeTypes = new Set([
    'application/msword',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/plain',
]);

export const messengerChatIdSchema = z.string().uuid();
export const messengerAttachmentPathSchema = z.string().trim().min(1).max(512);

const messageAttachmentSchema = z.object({
    name: z.string().trim().min(1).max(255),
    path: z.string().trim().min(1).max(512),
    type: z.string().trim().min(1).max(200).refine((value) => allowedAttachmentMimeTypes.has(value), {
        message: 'Unsupported attachment type',
    }),
    size: z.number().int().min(1).max(MESSENGER_MAX_ATTACHMENT_SIZE_BYTES),
});

export const messengerMessagePayloadSchema = z.object({
    chat_id: messengerChatIdSchema,
    content: z.string().trim().max(5000).optional().nullable(),
    attachments: z.array(messageAttachmentSchema).max(10).optional(),
}).superRefine((value, context) => {
    const hasContent = Boolean(value.content && value.content.trim().length > 0);
    const hasAttachments = Boolean(value.attachments && value.attachments.length > 0);

    if (!hasContent && !hasAttachments) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'content or attachments is required',
            path: ['content'],
        });
    }
});

export const attachmentUploadRequestSchema = z.object({
    chat_id: messengerChatIdSchema,
    file_name: z.string().trim().min(1).max(255),
    file_type: z.string().trim().min(1).max(200).refine((value) => allowedAttachmentMimeTypes.has(value), {
        message: 'Unsupported attachment type',
    }),
    file_size: z.number().int().min(1).max(MESSENGER_MAX_ATTACHMENT_SIZE_BYTES),
});

export const messengerMemberQuerySchema = z.object({
    chat_id: messengerChatIdSchema,
});

export const messengerChatMembersBodySchema = z.object({
    chat_id: messengerChatIdSchema,
    user_id: z.number().int().positive(),
});

export const messengerCreateChatBodySchema = z.object({
    type: z.enum(['direct', 'group']),
    name: z.string().trim().min(2).max(120).optional().nullable(),
    avatar_url: z.string().trim().url().max(2048).optional().nullable(),
    participant_ids: z.array(z.number().int().positive()).max(50).optional(),
    context_order_id: z.number().int().positive().optional().nullable(),
}).superRefine((value, context) => {
    if (value.type === 'direct') {
        if (!value.participant_ids || value.participant_ids.length !== 1) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Direct chat requires exactly one other participant',
                path: ['participant_ids'],
            });
        }
        return;
    }

    if (!value.name || value.name.trim().length < 2) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Group chat name must be between 2 and 120 characters',
            path: ['name'],
        });
    }
});

export const messengerPatchChatBodySchema = z.object({
    chat_id: messengerChatIdSchema,
    name: z.string().trim().min(2).max(120).optional(),
    avatar_url: z.string().trim().url().max(2048).nullable().optional(),
});

export const messengerDeleteChatBodySchema = z.object({
    chat_id: messengerChatIdSchema,
});

export const messengerChatAvatarUploadRequestSchema = z.object({
    chat_id: messengerChatIdSchema,
    file_name: z.string().trim().min(1).max(255),
    file_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    file_size: z.number().int().min(1).max(MESSENGER_MAX_AVATAR_SIZE_BYTES),
});

const webPushSubscriptionKeysSchema = z.object({
    p256dh: z.string().trim().min(1).max(1024),
    auth: z.string().trim().min(1).max(1024),
});

export const messengerPushSubscriptionBodySchema = z.object({
    endpoint: z.string().trim().url().max(2048),
    expirationTime: z.number().nullable().optional(),
    keys: webPushSubscriptionKeysSchema,
    platform: z.string().trim().min(1).max(120).optional().nullable(),
    browser: z.string().trim().min(1).max(120).optional().nullable(),
    device_label: z.string().trim().min(1).max(160).optional().nullable(),
    user_agent: z.string().trim().min(1).max(1000).optional().nullable(),
    permission_state: z.enum(['default', 'denied', 'granted']).optional(),
    chat_scope: z.record(z.string(), z.unknown()).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
});

export const messengerDeletePushSubscriptionBodySchema = z.object({
    endpoint: z.string().trim().url().max(2048),
});

export const messengerPushSubscriptionSettingsSchema = z.object({
    enabled: z.boolean().optional(),
    delivery_mode: z.enum(['all', 'direct_only', 'mentions_only']).optional(),
    preview_mode: z.enum(['full', 'safe', 'hidden']).optional(),
    muted_chat_ids: z.array(messengerChatIdSchema).max(200).optional(),
});

export const messengerPatchPushSubscriptionBodySchema = z.object({
    endpoint: z.string().trim().url().max(2048),
    settings: messengerPushSubscriptionSettingsSchema,
});

export const messengerPushPresenceBodySchema = z.object({
    endpoint: z.string().trim().url().max(2048),
    tab_id: z.string().trim().min(1).max(120),
    chat_id: messengerChatIdSchema.nullable().optional(),
    page_path: z.string().trim().min(1).max(512).optional().nullable(),
    page_visible: z.boolean(),
    focused: z.boolean(),
});

export async function getMessengerParticipant(chatId: string, userId: number) {
    const { data, error } = await supabase
        .from('chat_participants')
        .select('chat_id, user_id, role, last_read_at')
        .eq('chat_id', chatId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

export function sanitizeAttachmentFileName(fileName: string) {
    const sanitized = fileName
        .normalize('NFKC')
        .replace(/[\\/]/g, '-')
        .replace(/[^a-zA-Z0-9._()\-\s]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();

    return sanitized.slice(0, 120) || 'file';
}

export function isAttachmentPathAllowedForChat(chatId: string, filePath: string) {
    if (!filePath || filePath.includes('..')) {
        return false;
    }

    return filePath.startsWith(`${chatId}/`);
}

export function normalizeMessengerAttachments(
    attachments: Array<z.infer<typeof messageAttachmentSchema>> | undefined,
) {
    return (attachments || []).map((attachment) => ({
        name: sanitizeAttachmentFileName(attachment.name),
        path: attachment.path,
        type: attachment.type,
        size: attachment.size,
    }));
}