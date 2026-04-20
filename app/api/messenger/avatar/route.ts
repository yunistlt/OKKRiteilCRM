import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logMessengerError } from '@/lib/messenger/logger';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

function extractChatIdFromAvatarPath(filePath: string) {
    const match = /^avatars\/chats\/([^/]+)\//.exec(filePath);
    return match?.[1] || null;
}

export async function GET(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const filePath = searchParams.get('path');

        if (!filePath || filePath.includes('..')) {
            return NextResponse.json({ error: 'path is required' }, { status: 400 });
        }

        const chatId = extractChatIdFromAvatarPath(filePath);
        if (chatId) {
            const { data: participant, error: participantError } = await supabase
                .from('chat_participants')
                .select('chat_id')
                .eq('chat_id', chatId)
                .eq('user_id', userId)
                .maybeSingle();

            if (participantError) throw participantError;
            if (!participant) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const { data, error } = await supabase.storage
            .from('chat-attachments')
            .createSignedUrl(filePath, 60);

        if (error) throw error;

        return NextResponse.redirect(data.signedUrl, { status: 302 });
    } catch (error: unknown) {
        logMessengerError('attachments.get', error, {
            userId,
            method: 'GET',
            details: { stage: 'avatar_redirect' },
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}