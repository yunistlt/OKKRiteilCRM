import { getSession } from '@/lib/auth';
import { deleteChatAttachmentObjects } from '@/lib/messenger/storage';
import { supabase } from '@/utils/supabase';

type DirectChatRow = {
    id: string;
    type: 'direct' | 'group';
    name: string | null;
    context_order_id: number | null;
    created_at: string;
    updated_at: string;
};

type ChatParticipantLookupRow = {
    chat_id: string;
    user_id: number;
};

type GroupMemberRow = {
    user_id: number;
    role: string;
    joined_at: string;
};

export function getMessengerActorLabel(session: Awaited<ReturnType<typeof getSession>>) {
    return session?.user?.first_name || session?.user?.username || 'Участник';
}

export async function getMessengerManagerLabel(userId: number) {
    const { data } = await supabase
        .from('managers')
        .select('first_name, last_name')
        .eq('id', userId)
        .maybeSingle();

    const fullName = `${data?.first_name || ''} ${data?.last_name || ''}`.trim();
    return fullName || `Участник ${userId}`;
}

export async function createMessengerSystemMessage(chatId: string, content: string) {
    const { error } = await supabase.from('messages').insert({
        chat_id: chatId,
        sender_id: null,
        content,
    });

    if (error) {
        throw error;
    }
}

export async function touchMessengerChat(chatId: string) {
    const { error } = await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

    if (error) {
        throw error;
    }
}

export async function findExistingDirectMessengerChat(userA: number, userB: number) {
    const { data: participantRows, error: participantError } = await supabase
        .from('chat_participants')
        .select('chat_id, user_id')
        .in('user_id', [userA, userB]);

    if (participantError) {
        throw participantError;
    }

    const typedParticipantRows = (participantRows || []) as ChatParticipantLookupRow[];

    const participantMap = new Map<string, Set<number>>();
    for (const row of typedParticipantRows) {
        if (!participantMap.has(row.chat_id)) {
            participantMap.set(row.chat_id, new Set());
        }
        participantMap.get(row.chat_id)?.add(row.user_id);
    }

    const candidateChatIds = Array.from(participantMap.entries())
        .filter(([, users]) => users.has(userA) && users.has(userB))
        .map(([chatId]) => chatId);

    if (candidateChatIds.length === 0) {
        return null;
    }

    const { data: directChats, error: directChatsError } = await supabase
        .from('chats')
        .select('id, type, name, context_order_id, created_at, updated_at')
        .in('id', candidateChatIds)
        .eq('type', 'direct')
        .order('updated_at', { ascending: false })
        .limit(1);

    if (directChatsError) {
        throw directChatsError;
    }

    const typedDirectChats = (directChats || []) as DirectChatRow[];

    return typedDirectChats[0] || null;
}

export async function leaveMessengerGroupChat(params: {
    chatId: string;
    userId: number;
    actorRole?: string | null;
    actorLabel: string;
}) {
    const { chatId, userId, actorRole, actorLabel } = params;

    const { data: allMembers, error: allMembersError } = await supabase
        .from('chat_participants')
        .select('user_id, role, joined_at')
        .eq('chat_id', chatId)
        .order('joined_at', { ascending: true });

    if (allMembersError) {
        throw allMembersError;
    }

    const typedAllMembers = (allMembers || []) as GroupMemberRow[];
    const remainingMembers = typedAllMembers.filter((member) => member.user_id !== userId);

    const { error: leaveError } = await supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', userId);

    if (leaveError) {
        throw leaveError;
    }

    if (remainingMembers.length === 0) {
        await deleteChatAttachmentObjects(chatId);

        const { error: deleteChatError } = await supabase
            .from('chats')
            .delete()
            .eq('id', chatId);

        if (deleteChatError) {
            throw deleteChatError;
        }

        return { chatDeleted: true };
    }

    if (actorRole === 'admin' && !remainingMembers.some((member) => member.role === 'admin')) {
        const nextAdmin = remainingMembers[0];
        if (nextAdmin) {
            const { error: promoteError } = await supabase
                .from('chat_participants')
                .update({ role: 'admin' })
                .eq('chat_id', chatId)
                .eq('user_id', nextAdmin.user_id);

            if (promoteError) {
                throw promoteError;
            }
        }
    }

    await createMessengerSystemMessage(chatId, `${actorLabel} покинул чат`);
    await touchMessengerChat(chatId);

    return { chatDeleted: false };
}