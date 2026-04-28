import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const sessionId = formData.get('sessionId') as string;
        const visitorId = formData.get('visitorId') as string;

        if (!file || !visitorId) {
            return NextResponse.json({ error: 'Missing file or visitorId' }, { status: 400, headers: CORS_HEADERS });
        }

        // 1. Get Session ID if not provided
        let actualSessionId = sessionId;
        if (!actualSessionId) {
            const { data: sess } = await supabase.from('widget_sessions').select('id').eq('visitor_id', visitorId).single();
            if (sess) actualSessionId = sess.id;
        }

        if (!actualSessionId) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404, headers: CORS_HEADERS });
        }

        // 2. Upload to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${actualSessionId}/${Date.now()}.${fileExt}`;
        const filePath = `chat-attachments/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('okk-assets') // Using existing or creating bucket
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) {
            // If bucket doesn't exist, try to create it (though usually done via UI)
            console.error('Upload error:', uploadError);
            return NextResponse.json({ error: uploadError.message }, { status: 500, headers: CORS_HEADERS });
        }

        const { data: { publicUrl } } = supabase.storage.from('okk-assets').getPublicUrl(filePath);

        // 3. Save message with file
        const { data: message, error: msgError } = await supabase.from('widget_messages').insert({
            session_id: actualSessionId,
            role: 'user',
            content: `[Файл]: ${file.name}`,
            file_url: publicUrl,
            file_name: file.name
        }).select().single();

        return NextResponse.json({ 
            success: true, 
            message,
            fileUrl: publicUrl 
        }, { headers: CORS_HEADERS });

    } catch (error: any) {
        console.error('Upload API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }
}
