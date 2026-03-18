import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/messenger/attachments
 * Generates a signed upload URL for a file.
 * Expects { chat_id, file_name, file_type }
 */
export async function POST(req: Request) {
    try {
        const session = await getSession();
        const userId = session?.user?.retail_crm_manager_id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { chat_id, file_name, file_type } = body;

        if (!chat_id || !file_name) {
            return NextResponse.json({ error: 'chat_id and file_name are required' }, { status: 400 });
        }

        // Generate a unique path: {chat_id}/{timestamp}_{file_name}
        const filePath = `${chat_id}/${Date.now()}_${file_name}`;

        const { data, error } = await supabase.storage
            .from('chat-attachments')
            .createSignedUploadUrl(filePath);

        if (error) throw error;

        return NextResponse.json({
            upload_url: data.signedUrl,
            file_path: filePath,
            token: data.token
        });
    } catch (error: any) {
        console.error('[Attachments API POST] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
