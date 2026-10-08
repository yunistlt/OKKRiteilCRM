import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { BUCKET, entityBySlug, entityFiles } from '@/lib/legal-entity/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Уставные документы нашей компании — для клиента, без входа в систему.
 *
 * `/api/public/docs/zmk` — список файлов (его читает страница `/docs/zmk`).
 * `/api/public/docs/zmk?file=12` — сам файл.
 *
 * Отдаём ТОЛЬКО то, что помечено публичным в карточке юрлица: налоговые
 * декларации и договор аренды лежат рядом, но клиенту их никто не обещал.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const entity = await entityBySlug(slug);
    if (!entity) return NextResponse.json({ error: 'Компания не найдена' }, { status: 404 });

    const files = await entityFiles(entity.id, true);
    const fileId = new URL(req.url).searchParams.get('file');

    if (!fileId) {
        return NextResponse.json({
            ok: true,
            company: entity.name,
            inn: entity.inn,
            files: files.map((file) => ({
                id: file.id,
                name: file.fileName,
                folder: file.folder,
                size: file.size,
            })),
        });
    }

    const file = files.find((item) => String(item.id) === String(fileId));
    if (!file) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });

    const stored = await supabase.storage.from(BUCKET).download(file.storagePath);
    if (stored.error || !stored.data) {
        console.error('[public-docs] файл не читается:', file.storagePath, stored.error?.message);
        return NextResponse.json({ error: 'Документ не читается' }, { status: 502 });
    }

    const bytes = Buffer.from(await stored.data.arrayBuffer());
    return new NextResponse(bytes, {
        headers: {
            'Content-Type': file.contentType || 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
            // Документы меняются редко, но не бесконечно: час кэша.
            'Cache-Control': 'public, max-age=3600',
        },
    });
}
