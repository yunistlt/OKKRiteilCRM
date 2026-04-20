import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import {
    createMessengerSystemMessage,
    getMessengerActorLabel,
    getMessengerManagerLabel,
    leaveMessengerGroupChat,
    touchMessengerChat,
} from '@/lib/messenger/domain';
import { logMessengerError } from '@/lib/messenger/logger';
import {
    getMessengerParticipant,
    messengerChatMembersBodySchema,
    messengerMemberQuerySchema,
} from '@/lib/messenger/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messenger/chats/members?chat_id=xxx
 * Returns all participants for a chat.
 */
export async function GET(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(req.url);
        const parsedQuery = messengerMemberQuerySchema.safeParse({
            chat_id: searchParams.get('chat_id'),
        });
        if (!parsedQuery.success) {
            return NextResponse.json({ error: parsedQuery.error.issues[0]?.message || 'Invalid query params' }, { status: 400 });
        }

        const { chat_id: chatId } = parsedQuery.data;

        // Verify user is a participant of this chat
        const myRecord = await getMessengerParticipant(chatId, userId);

        if (!myRecord) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const { data, error } = await supabase
            .from('chat_participants')
            .select(`
                user_id,
                role,
                joined_at,
                managers (
                    id,
                    first_name,
                    last_name,
                    username
                )
            `)
            .eq('chat_id', chatId);

        if (error) throw error;

        return NextResponse.json({ members: data, myRole: myRecord.role });
    } catch (error: unknown) {
        logMessengerError('members.get', error, {
            userId,
            method: 'GET',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

/**
 * POST /api/messenger/chats/members
 * Adds a participant to a chat (admin only).
 * Body: { chat_id, user_id }
 */
export async function POST(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const parsedBody = messengerChatMembersBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const { chat_id, user_id } = parsedBody.data;

        // Verify caller is admin of this chat
        const myRecord = await getMessengerParticipant(chat_id, userId);

        if (!myRecord || myRecord.role !== 'admin') {
            return NextResponse.json({ error: 'Only admins can add members' }, { status: 403 });
        }

        // Check if already a member
        const { data: existing } = await supabase
            .from('chat_participants')
            .select('user_id')
            .eq('chat_id', chat_id)
            .eq('user_id', user_id)
            .single();

        if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 409 });

        const { error } = await supabase
            .from('chat_participants')
            .insert({ chat_id, user_id, role: 'member' });

        if (error) throw error;

        const actorLabel = getMessengerActorLabel(session);
        const addedUserLabel = await getMessengerManagerLabel(user_id);
        await createMessengerSystemMessage(chat_id, `${actorLabel} добавил в чат ${addedUserLabel}`);

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        logMessengerError('members.post', error, {
            userId,
            method: 'POST',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

/**
 * DELETE /api/messenger/chats/members
 * Removes a participant from a chat (admin only).
 * Body: { chat_id, user_id }
 */
export async function DELETE(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const parsedBody = messengerChatMembersBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const { chat_id, user_id } = parsedBody.data;

        const myRecord = await getMessengerParticipant(chat_id, userId);

        const { data: chatRecord } = await supabase
            .from('chats')
            .select('id, type')
            .eq('id', chat_id)
            .single();

        if (!chatRecord) {
            return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
        }

        const isSelfRemoval = user_id === userId;

        if (isSelfRemoval) {
            if (chatRecord.type !== 'group') {
                return NextResponse.json({ error: 'Cannot leave direct chat' }, { status: 400 });
            }

            const result = await leaveMessengerGroupChat({
                chatId: chat_id,
                userId,
                actorRole: myRecord?.role,
                actorLabel: getMessengerActorLabel(session),
            });

            return NextResponse.json({ success: true, left: true, chat_deleted: result.chatDeleted });
        }

        if (!myRecord || myRecord.role !== 'admin') {
            return NextResponse.json({ error: 'Only admins can remove members' }, { status: 403 });
        }

        const { error } = await supabase
            .from('chat_participants')
            .delete()
            .eq('chat_id', chat_id)
            .eq('user_id', user_id);

        if (error) throw error;

        const actorLabel = getMessengerActorLabel(session);
        const removedUserLabel = await getMessengerManagerLabel(user_id);
        await createMessengerSystemMessage(chat_id, `${actorLabel} удалил из чата ${removedUserLabel}`);
        await touchMessengerChat(chat_id);

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        logMessengerError('members.delete', error, {
            userId,
            method: 'DELETE',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
