import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messenger/chats/members?chat_id=xxx
 * Returns all participants for a chat.
 */
export async function GET(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(req.url);
        const chatId = searchParams.get('chat_id');
        if (!chatId) return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });

        // Verify user is a participant of this chat
        const { data: myRecord } = await supabase
            .from('chat_participants')
            .select('role')
            .eq('chat_id', chatId)
            .eq('user_id', userId)
            .single();

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
    } catch (error: any) {
        console.error('[Members API GET]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/messenger/chats/members
 * Adds a participant to a chat (admin only).
 * Body: { chat_id, user_id }
 */
export async function POST(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { chat_id, user_id } = await req.json();
        if (!chat_id || !user_id) return NextResponse.json({ error: 'chat_id and user_id required' }, { status: 400 });

        // Verify caller is admin of this chat
        const { data: myRecord } = await supabase
            .from('chat_participants')
            .select('role')
            .eq('chat_id', chat_id)
            .eq('user_id', userId)
            .single();

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

        // Post system message
        await supabase.from('messages').insert({
            chat_id,
            sender_id: null,
            content: `Новый участник добавлен в чат`
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Members API POST]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * DELETE /api/messenger/chats/members
 * Removes a participant from a chat (admin only).
 * Body: { chat_id, user_id }
 */
export async function DELETE(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { chat_id, user_id } = await req.json();
        if (!chat_id || !user_id) return NextResponse.json({ error: 'chat_id and user_id required' }, { status: 400 });

        // Verify caller is admin of this chat
        const { data: myRecord } = await supabase
            .from('chat_participants')
            .select('role')
            .eq('chat_id', chat_id)
            .eq('user_id', userId)
            .single();

        if (!myRecord || myRecord.role !== 'admin') {
            return NextResponse.json({ error: 'Only admins can remove members' }, { status: 403 });
        }

        // Can't remove yourself (use leave chat logic instead)
        if (user_id === userId) {
            return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
        }

        const { error } = await supabase
            .from('chat_participants')
            .delete()
            .eq('chat_id', chat_id)
            .eq('user_id', user_id);

        if (error) throw error;

        // Post system message
        await supabase.from('messages').insert({
            chat_id,
            sender_id: null,
            content: `Участник удалён из чата`
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Members API DELETE]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
