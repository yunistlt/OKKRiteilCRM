import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { logMessengerError } from '@/lib/messenger/logger';
import { dispatchMessengerPushNotifications } from '@/lib/messenger/push';
import {
    getMessengerParticipant,
    messengerChatIdSchema,
    messengerMessagePayloadSchema,
    normalizeMessengerAttachments,
} from '@/lib/messenger/security';
import { deleteMessageAttachmentObjects } from '@/lib/messenger/storage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messenger/messages?chat_id=...&limit=50&offset=0
 * Returns message history for a specific chat.
 */
export async function GET(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const rawChatId = searchParams.get('chat_id');
        const parsedChatId = messengerChatIdSchema.safeParse(rawChatId);
        const rawLimit = Number.parseInt(searchParams.get('limit') || '50', 10);
        const rawOffset = Number.parseInt(searchParams.get('offset') || '0', 10);

        if (!parsedChatId.success) {
            return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
        }

        const chatId = parsedChatId.data;
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
        const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

        const participant = await getMessengerParticipant(chatId, userId);
        if (!participant) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { data: messages, error, count } = await supabase
            .from('messages')
            .select('*', { count: 'exact' })
            .eq('chat_id', chatId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Mark as read for this user
        await supabase
            .from('chat_participants')
            .update({ last_read_at: new Date().toISOString() })
            .eq('chat_id', chatId)
            .eq('user_id', userId);

        return NextResponse.json({
            messages: messages || [],
            total: count || 0
        });
    } catch (error: unknown) {
        logMessengerError('messages.get', error, {
            userId: session?.user?.retail_crm_manager_id ?? null,
            method: 'GET',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

/**
 * POST /api/messenger/messages
 * Sends a new message to a chat.
 */
export async function POST(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const parsedBody = messengerMessagePayloadSchema.safeParse(body);
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request payload' }, { status: 400 });
        }

        const { chat_id, content, attachments } = parsedBody.data;

        const participant = await getMessengerParticipant(chat_id, userId);
        if (!participant) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const normalizedAttachments = normalizeMessengerAttachments(attachments);

        const { data: newMessage, error: insertError } = await supabase
            .from('messages')
            .insert({
                chat_id,
                sender_id: userId,
                content: content?.trim() || null,
                attachments: normalizedAttachments
            })
            .select()
            .single();

        if (insertError) throw insertError;

        await Promise.all([
            supabase
                .from('chats')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', chat_id),
            dispatchMessengerPushNotifications({
                message: {
                    id: newMessage.id,
                    chat_id: newMessage.chat_id,
                    sender_id: newMessage.sender_id,
                    content: newMessage.content,
                    attachments: Array.isArray(newMessage.attachments)
                        ? newMessage.attachments as Array<{ name?: string; type?: string }>
                        : null,
                    created_at: newMessage.created_at,
                },
            }),
        ]);

        return NextResponse.json(newMessage);
    } catch (error: unknown) {
        logMessengerError('messages.post', error, {
            userId: session?.user?.retail_crm_manager_id ?? null,
            method: 'POST',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

/**
 * DELETE /api/messenger/messages
 * Deletes a message authored by the current user.
 * Body: { message_id }
 */
export async function DELETE(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { message_id } = await req.json();
        if (!message_id || typeof message_id !== 'string') {
            return NextResponse.json({ error: 'message_id is required' }, { status: 400 });
        }

        const { data: message, error: messageError } = await supabase
            .from('messages')
            .select('id, chat_id, sender_id')
            .eq('id', message_id)
            .maybeSingle();

        if (messageError) throw messageError;
        if (!message) {
            return NextResponse.json({ error: 'Message not found' }, { status: 404 });
        }

        const participant = await getMessengerParticipant(message.chat_id, userId);
        if (!participant) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (Number(message.sender_id) !== Number(userId)) {
            return NextResponse.json({ error: 'You can delete only your own messages' }, { status: 403 });
        }

        await deleteMessageAttachmentObjects(message_id);

        const { error: deleteError } = await supabase
            .from('messages')
            .delete()
            .eq('id', message_id)
            .eq('sender_id', userId);

        if (deleteError) throw deleteError;

        await supabase
            .from('chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', message.chat_id);

        return NextResponse.json({ success: true, deleted: true, message_id });
    } catch (error: unknown) {
        logMessengerError('messages.delete', error, {
            userId: session?.user?.retail_crm_manager_id ?? null,
            method: 'DELETE',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
