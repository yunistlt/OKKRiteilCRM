import AdmZip from 'adm-zip';
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { BUCKET, entityBySlug, entityFiles } from '@/lib/legal-entity/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Уставные документы нашей компании — для клиента, без входа в систему.
 *
 * `/api/public/docs/zmk` — список файлов (его читает страница `/docs/zmk`).
 * `/api/public/docs/zmk?file=12` — сам файл: ссылку можно дать клиенту прямо
 *   в письме, он скачает одним щелчком.
 * `/api/public/docs/zmk?zip=1` — все документы одним архивом: клиенту с
 *   полсотней файлов по одному кликать незачем.
 *
 * Отдаём ТОЛЬКО то, что помечено публичным в карточке юрлица: налоговые
 * декларации и договор аренды лежат рядом, но клиенту их никто не обещал.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const entity = await entityBySlug(slug);
    if (!entity) return NextResponse.json({ error: 'Компания не найдена' }, { status: 404 });

    const files = await entityFiles(entity.id, true);
    const params2 = new URL(req.url).searchParams;
    const fileId = params2.get('file');

    if (params2.get('zip')) {
        const zip = new AdmZip();
        for (const file of files) {
            const stored = await supabase.storage.from(BUCKET).download(file.storagePath);
            if (stored.error || !stored.data) continue;
            // Папки с Диска сохраняем внутри архива: «Устав/…».
            const inner = file.folder ? `${file.folder}/${file.fileName}` : file.fileName;
            zip.addFile(inner, Buffer.from(await stored.data.arrayBuffer()));
        }

        const name = `Документы ${entity.name}.zip`;
        return new NextResponse(new Uint8Array(zip.toBuffer()), {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
                'Cache-Control': 'public, max-age=600',
            },
        });
    }

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
