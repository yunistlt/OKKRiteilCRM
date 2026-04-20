import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
    MESSENGER_MAX_AVATAR_SIZE_BYTES,
    sanitizeAttachmentFileName,
} from '@/lib/messenger/security';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const fileName = typeof body?.file_name === 'string' ? body.file_name : '';
        const fileType = typeof body?.file_type === 'string' ? body.file_type : '';
        const fileSize = typeof body?.file_size === 'number' ? body.file_size : 0;

        if (!fileName || !ALLOWED_AVATAR_MIME_TYPES.has(fileType)) {
            return NextResponse.json({ error: 'Unsupported avatar type' }, { status: 400 });
        }

        if (fileSize <= 0 || fileSize > MESSENGER_MAX_AVATAR_SIZE_BYTES) {
            return NextResponse.json({ error: 'Avatar file is too large' }, { status: 400 });
        }

        const safeFileName = sanitizeAttachmentFileName(fileName);
        const filePath = `avatars/users/${session.user.id}/${Date.now()}_${safeFileName}`;

        const { data, error } = await supabase.storage
            .from('chat-attachments')
            .createSignedUploadUrl(filePath, { upsert: true });

        if (error) {
            throw error;
        }

        return NextResponse.json({
            upload_url: data.signedUrl,
            file_path: filePath,
        });
    } catch (error: unknown) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}