/**
 * Выдаёт сам файл паспорта или инструкции из ЦехУспеха.
 *
 * Файл читается только здесь и только по одному: в поиске блобы не трогаются
 * вовсе, иначе он уходит с секунды в минуты.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { readProductDoc, type DocSource } from '@/lib/product-docs/search';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCES: DocSource[] = ['set', 'detail', 'product'];

/** Тип содержимого — по расширению: в ЦехУспехе колонка ExtFile почти всегда пустая. */
const TYPES: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip: 'application/zip',
    dwg: 'application/acad',
};

/**
 * Имя файла стоит в адресе ради просмотрщика браузера: при «Сохранить как» из
 * открытого PDF он берёт имя из адреса, а не из заголовка. На выбор файла имя
 * не влияет — файл находят по source и id.
 */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const source = String(params.get('source') ?? '') as DocSource;
    const fileId = Number(params.get('id'));

    if (!SOURCES.includes(source) || !Number.isFinite(fileId)) {
        return NextResponse.json({ error: 'Файл не указан' }, { status: 400 });
    }

    let doc: Awaited<ReturnType<typeof readProductDoc>>;
    try {
        doc = await readProductDoc(source, fileId);
    } catch (error) {
        console.error('[product-docs] файл из ЦехУспеха не прочитался:', error);
        return NextResponse.json({ error: 'База ЦехУспеха сейчас не отвечает' }, { status: 503 });
    }

    if (!doc) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

    const ext = doc.fileName.includes('.') ? doc.fileName.split('.').pop()!.toLowerCase() : '';
    const type = TYPES[ext] ?? 'application/octet-stream';

    return new NextResponse(new Uint8Array(doc.content), {
        headers: {
            'Content-Type': type,
            // PDF и картинки открываем в окне, остальное скачиваем. Имя файла —
            // русское, поэтому только в кодированном виде (RFC 5987).
            'Content-Disposition':
                `${type === 'application/pdf' || type.startsWith('image/') ? 'inline' : 'attachment'}` +
                `; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
            'Content-Length': String(doc.content.length),
            'Cache-Control': 'private, max-age=300',
        },
    });
}
