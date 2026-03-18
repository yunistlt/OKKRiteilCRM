import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

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
        const chatId = searchParams.get('chat_id');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        if (!chatId) {
            return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
        }

        // RLS will handle the security check, but we can also explicitly check participation if needed.
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
    } catch (error: any) {
        console.error('[Messages API GET] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
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
        const { chat_id, content, attachments } = body;

        if (!chat_id || (!content && !attachments)) {
            return NextResponse.json({ error: 'chat_id and (content or attachments) are required' }, { status: 400 });
        }

        const { data: newMessage, error: insertError } = await supabase
            .from('messages')
            .insert({
                chat_id,
                sender_id: userId,
                content: content || null,
                attachments: attachments || []
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // Update chat's updated_at to bring it to top of list
        await supabase
            .from('chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', chat_id);

        return NextResponse.json(newMessage);
    } catch (error: any) {
        console.error('[Messages API POST] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
