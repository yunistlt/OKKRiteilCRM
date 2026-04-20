import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { logMessengerError } from '@/lib/messenger/logger';
import {
    attachmentUploadRequestSchema,
    getMessengerParticipant,
    isAttachmentPathAllowedForChat,
    messengerAttachmentPathSchema,
    messengerChatIdSchema,
    sanitizeAttachmentFileName,
} from '@/lib/messenger/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messenger/attachments?chat_id=...&path=...
 * Redirects to a short-lived signed download URL after access check.
 */
export async function GET(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const parsedChatId = messengerChatIdSchema.safeParse(searchParams.get('chat_id'));
        const parsedPath = messengerAttachmentPathSchema.safeParse(searchParams.get('path'));

        if (!parsedChatId.success || !parsedPath.success) {
            return NextResponse.json({ error: 'chat_id and path are required' }, { status: 400 });
        }

        const chatId = parsedChatId.data;
        const filePath = parsedPath.data;

        if (!isAttachmentPathAllowedForChat(chatId, filePath)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const participant = await getMessengerParticipant(chatId, userId);
        if (!participant) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

/**
 * POST /api/messenger/attachments
 * Generates a signed upload URL for a file.
 * Expects { chat_id, file_name, file_type }
 */
export async function POST(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const parsedBody = attachmentUploadRequestSchema.safeParse(body);
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request payload' }, { status: 400 });
        }

        const { chat_id, file_name, file_type } = parsedBody.data;

        const participant = await getMessengerParticipant(chat_id, userId);
        if (!participant) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const safeFileName = sanitizeAttachmentFileName(file_name);

        // Generate a unique path: {chat_id}/{timestamp}_{file_name}
        const filePath = `${chat_id}/${Date.now()}_${safeFileName}`;

        const { data, error } = await supabase.storage
            .from('chat-attachments')
            .createSignedUploadUrl(filePath, {
                upsert: false,
            });

        if (error) throw error;

        return NextResponse.json({
            upload_url: data.signedUrl,
            file_path: filePath,
            token: data.token,
        });
    } catch (error: unknown) {
        logMessengerError('attachments.post', error, {
            userId,
            method: 'POST',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
