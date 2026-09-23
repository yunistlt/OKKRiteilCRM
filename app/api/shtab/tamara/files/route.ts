import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { extractTextFromBuffer } from '@/lib/email/attachment-parser';
import { DOC_BUCKET } from '@/lib/shtab/structure';
import { chatFiles, createChat, getChat, latestChat } from '@/lib/shtab/tamara-chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET  /api/shtab/tamara/files?chat_id=N — что приложено к разговору.
// POST /api/shtab/tamara/files — приложить файл (multipart: file, chat_id).
//
// Файл принадлежит разговору, а не реплике: приложенное в начале нужно и через
// десять вопросов, а привязка к реплике заставляла бы прикладывать заново.

const MAX_BYTES = 4 * 1024 * 1024;

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const raw = req.nextUrl.searchParams.get('chat_id');
        const chat = raw ? await getChat(Number(raw)) : await latestChat();
        if (!chat) return NextResponse.json({ files: [] });

        const files = await chatFiles(chat.id);
        return NextResponse.json({ files: files.map(({ text_content, ...f }) => f) });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) return NextResponse.json({ error: 'Файл не пришёл' }, { status: 400 });
        if (file.size === 0) return NextResponse.json({ error: 'Файл пустой' }, { status: 400 });
        if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Файл больше 4 МБ — такой не принимается' }, { status: 400 });

        const rawChat = form.get('chat_id');
        let chat = rawChat ? await getChat(Number(rawChat)) : await latestChat();
        // Файл можно приложить и до первого вопроса — тогда заводится разговор.
        if (!chat) chat = await createChat('Разбор документа');

        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
        const storagePath = `chat-${chat.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

        await supabase.storage.createBucket(DOC_BUCKET, { public: false }).catch(() => undefined);
        const { error: upError } = await supabase.storage
            .from(DOC_BUCKET)
            .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (upError) throw new Error(`Файл не загрузился: ${upError.message}`);

        let text = '';
        try {
            text = await extractTextFromBuffer(buffer, file.name);
        } catch {
            text = '';
        }

        const { data, error } = await supabase
            .from('shtab_tamara_file')
            .insert({
                chat_id: chat.id,
                title: String(form.get('title') || '').trim() || file.name,
                file_name: file.name,
                content_type: file.type || '',
                size_bytes: file.size,
                storage_bucket: DOC_BUCKET,
                storage_path: storagePath,
                text_content: text.slice(0, 200_000),
            })
            .select('id, chat_id, title, file_name, size_bytes, created_at')
            .single();
        if (error) throw new Error(error.message);

        return NextResponse.json({ ...data, has_text: Boolean(text.trim()), chat_id: chat.id }, { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
