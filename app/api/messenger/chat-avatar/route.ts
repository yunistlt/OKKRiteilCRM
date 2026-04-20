import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logMessengerError } from '@/lib/messenger/logger';
import {
    messengerChatAvatarUploadRequestSchema,
    sanitizeAttachmentFileName,
} from '@/lib/messenger/security';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsedBody = messengerChatAvatarUploadRequestSchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request payload' }, { status: 400 });
        }

        const { chat_id, file_name, file_type } = parsedBody.data;

        const [{ data: participant, error: participantError }, { data: chat, error: chatError }] = await Promise.all([
            supabase
                .from('chat_participants')
                .select('role')
                .eq('chat_id', chat_id)
                .eq('user_id', userId)
                .maybeSingle(),
            supabase
                .from('chats')
                .select('type')
                .eq('id', chat_id)
                .maybeSingle(),
        ]);

        if (participantError) throw participantError;
        if (chatError) throw chatError;

        if (!participant || participant.role !== 'admin') {
            return NextResponse.json({ error: 'Only admins can update group avatar' }, { status: 403 });
        }

        if (!chat || chat.type !== 'group') {
            return NextResponse.json({ error: 'Group avatar is available only for group chats' }, { status: 400 });
        }

        const safeFileName = sanitizeAttachmentFileName(file_name);
        const filePath = `avatars/chats/${chat_id}/${Date.now()}_${safeFileName}`;

        const { data, error } = await supabase.storage
            .from('chat-attachments')
            .createSignedUploadUrl(filePath, { upsert: true });

        if (error) throw error;

        return NextResponse.json({
            upload_url: data.signedUrl,
            file_path: filePath,
            token: data.token,
            content_type: file_type,
        });
    } catch (error: unknown) {
        logMessengerError('chats.rename', error, {
            userId,
            method: 'POST',
            details: { stage: 'chat_avatar_upload' },
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}