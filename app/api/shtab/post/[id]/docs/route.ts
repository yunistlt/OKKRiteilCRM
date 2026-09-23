import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { extractTextFromBuffer } from '@/lib/email/attachment-parser';
import { DOC_BUCKET } from '@/lib/shtab/structure';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET  /api/shtab/post/[id]/docs — документы поста.
// POST /api/shtab/post/[id]/docs — положить документ в папку поста (multipart).
//
// Текст извлекается сразу при загрузке и ложится рядом с файлом: Тамара читает
// текст, а не PDF, и разбирать файл на каждый её вопрос значило бы платить за
// это каждый раз. Разбор общий с почтой — lib/email/attachment-parser.ts.

/** Больше Vercel всё равно не примет в теле запроса, и об этом лучше сказать заранее. */
const MAX_BYTES = 4 * 1024 * 1024;

function parseId(raw: string): number | null {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        const id = parseId(params.id);
        if (!id) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const { data, error } = await supabase
            .from('shtab_post_doc')
            .select('id, post_id, title, file_name, content_type, size_bytes, storage_path, text_content, created_at')
            .eq('post_id', id)
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);

        return NextResponse.json({
            docs: (data ?? []).map((d: any) => ({ ...d, has_text: Boolean((d.text_content ?? '').trim()), text_content: undefined })),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        const id = parseId(params.id);
        if (!id) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const { data: post, error: postError } = await supabase.from('shtab_post').select('id').eq('id', id).maybeSingle();
        if (postError) throw new Error(postError.message);
        if (!post) return NextResponse.json({ error: 'Пост не найден' }, { status: 404 });

        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) return NextResponse.json({ error: 'Файл не пришёл' }, { status: 400 });
        if (file.size === 0) return NextResponse.json({ error: 'Файл пустой' }, { status: 400 });
        if (file.size > MAX_BYTES) {
            return NextResponse.json({ error: 'Файл больше 4 МБ — такой не принимается' }, { status: 400 });
        }

        const title = String(form.get('title') || '').trim() || file.name;
        const buffer = Buffer.from(await file.arrayBuffer());

        // Имя в хранилище — своё: в исходных именах бывают пробелы, кириллица и
        // скобки, а ключ объекта потом лежит в базе и ходит в ссылках.
        const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
        const storagePath = `post-${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

        // Корзина заводится при первой загрузке: отдельного шага «создайте
        // bucket руками» быть не должно, его забудут при переносе на новый проект.
        await supabase.storage.createBucket(DOC_BUCKET, { public: false }).catch(() => undefined);

        const { error: upError } = await supabase.storage
            .from(DOC_BUCKET)
            .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (upError) throw new Error(`Файл не загрузился: ${upError.message}`);

        // Текст не извлёкся — документ всё равно сохраняем: файл владельцу
        // нужен, а «Тамара это не прочитает» видно в интерфейсе.
        let text = '';
        try {
            text = await extractTextFromBuffer(buffer, file.name);
        } catch {
            text = '';
        }

        const { data, error } = await supabase
            .from('shtab_post_doc')
            .insert({
                post_id: id,
                title,
                file_name: file.name,
                content_type: file.type || '',
                size_bytes: file.size,
                storage_bucket: DOC_BUCKET,
                storage_path: storagePath,
                text_content: text.slice(0, 200_000),
            })
            .select('id, post_id, title, file_name, content_type, size_bytes, storage_path, created_at')
            .single();
        if (error) throw new Error(error.message);

        return NextResponse.json({ ...data, has_text: Boolean(text.trim()) }, { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
