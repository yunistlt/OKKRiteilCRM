import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { extractTextFromContract } from '@/lib/legal-contract-analysis';
import { safeStorageSegment } from '@/lib/storage-path';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Документы судебного дела: претензии, отзывы, иски, решения.
 *
 * Кладём в бакет `legal-matters` и заводим строку в `legal_matter_documents` —
 * обе уже заведены миграцией реестра дел. Сразу вытаскиваем текст тем же
 * разборщиком, что и для договоров (`lib/legal-contract-analysis.ts`): без
 * сырого текста вывод по делу не доказать, это требование самого реестра.
 */
const BUCKET = 'legal-matters';
const MAX_BYTES = 25 * 1024 * 1024;

const safeName = (name: string) =>
    (name || 'file').replace(/[^\w.\-Ѐ-ӿ ]+/g, '_').slice(-120).trim();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const matterId = Number(id);
    if (!Number.isFinite(matterId)) {
        return NextResponse.json({ error: 'Дело не найдено' }, { status: 400 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Файл не приложен' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: 'Файл больше 25 МБ — такой не примем' }, { status: 400 });
    }

    const docKind = String(form?.get('docKind') || '') || null;
    const direction = String(form?.get('direction') || '') || null;
    const title = String(form?.get('title') || '') || null;

    // Имя в пути — латиницей: хранилище кириллицу в ключе не принимает.
    // Настоящее имя файла уходит в `file_name` и показывается человеку.
    const storagePath = `matters/${matterId}/${Date.now()}-${safeStorageSegment(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const upload = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
    });
    if (upload.error) {
        console.error('[matter-docs] файл не загрузился:', upload.error);
        return NextResponse.json({ error: 'Файл не загрузился — попробуйте ещё раз' }, { status: 500 });
    }

    // Текст достаём сразу: документ без текста в деле бесполезен — по нему не
    // найти цитату и не подтвердить факт.
    let rawText: string | null = null;
    let extractStatus = 'queued';
    let warnings: string[] = [];
    try {
        const extracted = await extractTextFromContract({
            bucket: BUCKET,
            storagePath,
            contentType: file.type,
            fileName: file.name,
        });
        rawText = extracted.text || null;
        extractStatus = extracted.status;
        warnings = extracted.warnings || [];
    } catch (e: any) {
        console.error('[matter-docs] текст не разобрался:', e?.message || e);
        extractStatus = 'failed';
        warnings = ['Текст документа не удалось прочитать'];
    }

    const { data, error } = await supabase
        .from('legal_matter_documents')
        .insert({
            matter_id: matterId,
            title,
            file_name: file.name,
            storage_bucket: BUCKET,
            storage_path: storagePath,
            content_type: file.type || null,
            file_size_bytes: buffer.length,
            upload_status: 'uploaded',
            doc_kind: docKind,
            direction,
            extract_status: extractStatus,
            extract_warnings: warnings.length ? warnings : null,
            raw_text: rawText,
            uploaded_by: session.user.email || session.user.role,
        })
        .select('id, file_name, doc_kind, direction, extract_status')
        .single();

    if (error) {
        console.error('[matter-docs] запись не сохранилась:', error);
        return NextResponse.json({ error: 'Документ не записался в дело' }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        document: data,
        note:
            extractStatus === 'completed'
                ? 'Документ загружен, текст прочитан.'
                : 'Документ загружен. Текст прочитать не удалось — он доступен файлом.',
    });
}

/** Скачать документ дела. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const docId = Number(searchParams.get('docId'));
    if (!Number.isFinite(docId)) {
        return NextResponse.json({ error: 'Документ не указан' }, { status: 400 });
    }

    const { data: doc } = await supabase
        .from('legal_matter_documents')
        .select('matter_id, file_name, content_type, storage_bucket, storage_path')
        .eq('id', docId)
        .maybeSingle();

    // Документ отдаём только из своего дела: ссылка с чужим номером ничего не откроет.
    if (!doc || String(doc.matter_id) !== String(id)) {
        return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });
    }

    const file = await supabase.storage.from(doc.storage_bucket || BUCKET).download(doc.storage_path);
    if (file.error || !file.data) {
        return NextResponse.json({ error: 'Файл не читается' }, { status: 404 });
    }

    return new NextResponse(Buffer.from(await file.data.arrayBuffer()), {
        headers: {
            'Content-Type': doc.content_type || 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
        },
    });
}
