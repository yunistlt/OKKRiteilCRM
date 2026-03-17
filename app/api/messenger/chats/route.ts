import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messenger/chats
 * Returns a list of chats for the current user including last message and participant details.
 */
export async function GET() {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 1. Get chat IDs where user is a participant
        const { data: participantRecords, error: participantError } = await supabase
            .from('chat_participants')
            .select('chat_id')
            .eq('user_id', userId);

        if (participantError) throw participantError;
        if (!participantRecords || participantRecords.length === 0) {
            return NextResponse.json([]);
        }

        const chatIds = participantRecords.map(p => p.chat_id);

        // 2. Fetch chat details
        const { data: chats, error: chatsError } = await supabase
            .from('chats')
            .select(`
                id,
                type,
                name,
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

        // 3. Fetch last message for each chat
        const chatsWithLastMessage = await Promise.all(chats.map(async (chat) => {
            const { data: lastMessages } = await supabase
                .from('messages')
                .select('content, created_at, sender_id')
                .eq('chat_id', chat.id)
                .order('created_at', { ascending: false })
                .limit(1);

            return {
                ...chat,
                last_message: lastMessages?.[0] || null
            };
        }));

        return NextResponse.json(chatsWithLastMessage);
    } catch (error: any) {
        console.error('[Chats API GET] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/messenger/chats
 * Creates a new chat. Handles direct duplication check.
 */
export async function POST(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { type, name, participant_ids, context_order_id } = body;

        if (type === 'direct') {
            if (!participant_ids || participant_ids.length !== 1) {
                return NextResponse.json({ error: 'Direct chat requires exactly one other participant' }, { status: 400 });
            }
            const otherUserId = participant_ids[0];

            // Check if direct chat already exists between these two
            // Query for chats of type direct where both users are participants
            const { data: existingChats, error: searchError } = await supabase
                .rpc('find_direct_chat', { 
                    user_a: userId, 
                    user_b: otherUserId 
                });

            if (searchError) {
                // Fallback if RPC doesn't exist yet (logic manually)
                // We'll implement the RPC in a separate migration if needed, 
                // but for now, let's assume we need to handle it.
            }

            if (existingChats && existingChats.length > 0) {
                return NextResponse.json(existingChats[0]);
            }
        }

        // Create new chat
        const { data: newChat, error: createError } = await supabase
            .from('chats')
            .insert({
                type,
                name: type === 'group' ? name : null,
                context_order_id: context_order_id || null
            })
            .select()
            .single();

        if (createError) throw createError;

        // Add participants
        const participants = [
            { chat_id: newChat.id, user_id: userId, role: 'admin' },
            ...(participant_ids || []).map((pId: number) => ({
                chat_id: newChat.id,
                user_id: pId,
                role: 'member'
            }))
        ];

        const { error: partError } = await supabase
            .from('chat_participants')
            .insert(participants);

        if (partError) throw partError;

        return NextResponse.json(newChat);
    } catch (error: any) {
        console.error('[Chats API POST] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
