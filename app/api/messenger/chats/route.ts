import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import {
    createMessengerSystemMessage,
    findExistingDirectMessengerChat,
    getMessengerActorLabel,
} from '@/lib/messenger/domain';
import { loadManagerAccountDirectory } from '@/lib/messenger/manager-usernames';
import { logMessengerError } from '@/lib/messenger/logger';
import {
    messengerCreateChatBodySchema,
    messengerDeleteChatBodySchema,
    messengerPatchChatBodySchema,
} from '@/lib/messenger/security';
import { deleteChatAttachmentObjects } from '@/lib/messenger/storage';

export const dynamic = 'force-dynamic';

const RETAILCRM_BASE = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || process.env.NEXT_PUBLIC_RETAILCRM_URL || 'https://zmktlt.retailcrm.ru').replace(/\/+$/, '');

type ParticipantRecord = {
    chat_id: string;
    last_read_at: string;
};

type ChatParticipant = {
    user_id: number;
    role: string;
    last_read_at: string;
    managers: {
        id: number;
        first_name: string | null;
        last_name: string | null;
        username?: string | null;
        avatar_url?: string | null;
    } | null;
};

type ChatRow = {
    id: string;
    type: 'direct' | 'group';
    name: string | null;
    avatar_url: string | null;
    context_order_id: number | null;
    created_at: string;
    updated_at: string;
    chat_participants: ChatParticipant[];
};

type OrderContextRow = {
    order_id: number;
    number: string | null;
    status: string | null;
};

type LastMessageRow = {
    content: string | null;
    created_at: string;
    sender_id: number | null;
};

/**
 * GET /api/messenger/chats
 * Returns a list of chats for the current user including last message and participant details.
 */
export async function GET(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;
        const { searchParams } = new URL(req.url);
        const onlyCount = searchParams.get('count') === 'true';

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 1. Get chat IDs where user is a participant
        const { data: participantRecords, error: participantError } = await supabase
            .from('chat_participants')
            .select('chat_id, last_read_at')
            .eq('user_id', userId);

        if (participantError) throw participantError;

        const typedParticipantRecords = (participantRecords || []) as ParticipantRecord[];

        if (typedParticipantRecords.length === 0) {
            return NextResponse.json(onlyCount ? { count: 0 } : []);
        }

        if (onlyCount) {
            // Efficiently count all unread messages across all chats
            let totalUnread = 0;
            await Promise.all(typedParticipantRecords.map(async (p) => {
                const { count } = await supabase
                    .from('messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('chat_id', p.chat_id)
                    .gt('created_at', p.last_read_at)
                    .or(`sender_id.is.null,sender_id.neq.${userId}`);
                totalUnread += (count || 0);
            }));
            return NextResponse.json({ count: totalUnread });
        }

        const chatIds = typedParticipantRecords.map((p) => p.chat_id);

        // 2. Fetch chat details
        const { data: chats, error: chatsError } = await supabase
            .from('chats')
            .select(`
                id,
                type,
                name,
                avatar_url,
                context_order_id,
                created_at,
                updated_at,
                chat_participants (
                    user_id,
                    role,
                    last_read_at,
                    managers (
                        id,
                        first_name,
                        last_name
                    )
                )
            `)
            .in('id', chatIds)
            .order('updated_at', { ascending: false });

        if (chatsError) throw chatsError;

        const typedChats = (chats || []) as ChatRow[];
        const managerDirectory = await loadManagerAccountDirectory(
            typedChats.flatMap((chat) => chat.chat_participants.map((participant) => participant.user_id))
        );

        const contextOrderIds = typedChats
            .map((chat) => chat.context_order_id)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

        const { data: relatedOrders, error: relatedOrdersError } = contextOrderIds.length > 0
            ? await supabase
                .from('orders')
                .select('order_id, number, status')
                .in('order_id', contextOrderIds)
            : { data: [] as OrderContextRow[], error: null };

        if (relatedOrdersError) throw relatedOrdersError;

        const typedRelatedOrders = (relatedOrders || []) as OrderContextRow[];

        const orderById = new Map(typedRelatedOrders.map((order) => [order.order_id, order]));

        // 3. Fetch last message and unread count for each chat
        const chatsWithMetadata = await Promise.all(typedChats.map(async (chat) => {
            const { data: lastMessages } = await supabase
                .from('messages')
                .select('content, created_at, sender_id')
                .eq('chat_id', chat.id)
                .order('created_at', { ascending: false })
                .limit(1);

            const typedLastMessages = (lastMessages || []) as LastMessageRow[];

            // Get current user's last_read_at for this chat
            const userParticipant = chat.chat_participants.find((participant) => participant.user_id === userId);
            const lastReadAt = userParticipant?.last_read_at || new Date(0).toISOString();

            // Count messages created after lastReadAt
            const { count: unreadCount } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('chat_id', chat.id)
                .gt('created_at', lastReadAt)
                .or(`sender_id.is.null,sender_id.neq.${userId}`);

            return {
                ...chat,
                chat_participants: chat.chat_participants.map((participant) => ({
                    ...participant,
                    managers: participant.managers
                        ? {
                            ...participant.managers,
                            username: managerDirectory.get(participant.user_id)?.username || null,
                            avatar_url: managerDirectory.get(participant.user_id)?.avatar_url || null,
                        }
                        : null,
                })),
                context_order: chat.context_order_id ? {
                    ...orderById.get(chat.context_order_id),
                    retailcrm_url: `${RETAILCRM_BASE}/orders/${chat.context_order_id}/edit`,
                } : null,
                last_message: typedLastMessages[0] || null,
                unread_count: unreadCount || 0
            };
        }));

        return NextResponse.json(chatsWithMetadata);
    } catch (error: unknown) {
        logMessengerError('chats.get', error, {
            userId,
            method: 'GET',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

/**
 * POST /api/messenger/chats
 * Creates a new chat. Handles direct duplication check.
 */
export async function POST(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsedBody = messengerCreateChatBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const { type, name, participant_ids, context_order_id, avatar_url } = parsedBody.data as typeof parsedBody.data & { avatar_url?: string | null };
        const directParticipantIds = participant_ids ?? [];

        if (context_order_id !== null && context_order_id !== undefined) {
            const { data: existingOrder } = await supabase
                .from('orders')
                .select('order_id')
                .eq('order_id', context_order_id)
                .maybeSingle();

            if (!existingOrder) {
                return NextResponse.json({ error: 'Order not found for context_order_id' }, { status: 400 });
            }
        }

        if (type === 'direct') {
            const otherUserId = directParticipantIds[0];

            if (typeof otherUserId !== 'number' || directParticipantIds.length !== 1) {
                return NextResponse.json({ error: 'Direct chat requires exactly one participant' }, { status: 400 });
            }

            const existingChat = await findExistingDirectMessengerChat(userId, otherUserId);

            if (existingChat) {
                return NextResponse.json(existingChat);
            }
        }

        // Create new chat
        const { data: newChat, error: createError } = await supabase
            .from('chats')
            .insert({
                type,
                name: type === 'group' ? name : null,
                avatar_url: type === 'group' ? avatar_url || null : null,
                context_order_id: context_order_id || null
            })
            .select()
            .single();

        if (createError) {
            logMessengerError('chats.create', createError, {
                userId,
                method: 'POST',
                details: { stage: 'create_chat' },
            });
            throw createError;
        }

        // Add participants
        const participants = [
            { chat_id: newChat.id, user_id: userId, role: 'admin' },
            ...(participant_ids || []).map((pId) => ({
                chat_id: newChat.id,
                user_id: pId,
                role: 'member'
            }))
        ];

        const { error: partError } = await supabase
            .from('chat_participants')
            .insert(participants);

        if (partError) {
            logMessengerError('chats.create', partError, {
                userId,
                chatId: newChat.id,
                method: 'POST',
                details: { stage: 'add_participants' },
            });
            throw partError;
        }

        if (type === 'group') {
            const actorLabel = getMessengerActorLabel(session);
            const groupLabel = (name || 'Группа').trim();
            await createMessengerSystemMessage(newChat.id, `${actorLabel} создал группу «${groupLabel}»`);
        }

        return NextResponse.json(newChat);
    } catch (error: unknown) {
        logMessengerError('chats.create', error, {
            userId,
            method: 'POST',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    let userId: number | null = null;
    let operation: 'chats.rename' | 'chats.markRead' = 'chats.markRead';

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const parsedBody = messengerPatchChatBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const { chat_id, name, avatar_url } = parsedBody.data;

        if (typeof name === 'string' || avatar_url !== undefined) {
            operation = 'chats.rename';
            const normalizedName = typeof name === 'string' ? name.trim() : undefined;

            const { data: myRecord } = await supabase
                .from('chat_participants')
                .select('role')
                .eq('chat_id', chat_id)
                .eq('user_id', userId)
                .single();

            if (!myRecord || myRecord.role !== 'admin') {
                return NextResponse.json({ error: 'Only admins can rename group chats' }, { status: 403 });
            }

            const { data: chatRecord } = await supabase
                .from('chats')
                .select('id, type, name')
                .eq('id', chat_id)
                .single();

            if (!chatRecord) {
                return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
            }

            if (chatRecord.type !== 'group') {
                return NextResponse.json({ error: 'Only group chats can be renamed' }, { status: 400 });
            }

            const updates: Record<string, unknown> = {
                updated_at: new Date().toISOString(),
            };

            if (normalizedName) {
                updates.name = normalizedName;
            }

            if (avatar_url !== undefined) {
                updates.avatar_url = avatar_url;
            }

            const { error: updateError } = await supabase
                .from('chats')
                .update(updates)
                .eq('id', chat_id);

            if (updateError) throw updateError;

            if (normalizedName && chatRecord.name !== normalizedName) {
                const actorLabel = getMessengerActorLabel(session);
                await createMessengerSystemMessage(chat_id, `${actorLabel} изменил название чата на «${normalizedName}»`);
            }

            return NextResponse.json({ success: true, renamed: Boolean(normalizedName), name: normalizedName || chatRecord.name, avatar_url: avatar_url ?? chatRecord.avatar_url ?? null });
        }

        const { error } = await supabase
            .from('chat_participants')
            .update({ last_read_at: new Date().toISOString() })
            .eq('chat_id', chat_id)
            .eq('user_id', userId);

        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        logMessengerError(operation, error, {
            userId,
            method: 'PATCH',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const parsedBody = messengerDeleteChatBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const { chat_id } = parsedBody.data;

        const { data: myRecord } = await supabase
            .from('chat_participants')
            .select('role')
            .eq('chat_id', chat_id)
            .eq('user_id', userId)
            .single();

        if (!myRecord || myRecord.role !== 'admin') {
            return NextResponse.json({ error: 'Only admins can delete group chats' }, { status: 403 });
        }

        const { data: chatRecord } = await supabase
            .from('chats')
            .select('id, type')
            .eq('id', chat_id)
            .single();

        if (!chatRecord) {
            return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
        }

        if (chatRecord.type !== 'group') {
            return NextResponse.json({ error: 'Only group chats can be deleted' }, { status: 400 });
        }

        await deleteChatAttachmentObjects(chat_id);

        const { error } = await supabase
            .from('chats')
            .delete()
            .eq('id', chat_id);

        if (error) throw error;

        return NextResponse.json({ success: true, deleted: true });
    } catch (error: unknown) {
        logMessengerError('chats.delete', error, {
            userId,
            method: 'DELETE',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
