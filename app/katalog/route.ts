/**
 * Каталог продукции по постоянной ссылке — без входа в систему.
 *
 * `/katalog` стоит кнопкой в каждом письме клиенту. Ссылка одна и та же
 * всегда: заменили файл в карточке юрлица — и старые письма ведут на новый
 * каталог.
 */
import { NextResponse } from 'next/server';
import { catalogBytes } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
    const catalog = await catalogBytes();

    if (!catalog) {
        // Человеческим языком: ссылку увидит клиент, а не разработчик.
        return new NextResponse(
            '<!doctype html><meta charset="utf-8"><title>Каталог продукции</title>'
            + '<p style="font:16px/1.5 system-ui;padding:24px">Каталог сейчас обновляется. '
            + 'Напишите нам на rop@zmktlt.ru — пришлём его письмом в тот же день.</p>',
            { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
    }

    // Показываем в браузере, а не скачиваем молча: «посмотрите наш каталог» —
    // человек открывает и листает, сохранит сам, если нужно.
    return new NextResponse(new Uint8Array(catalog.bytes), {
        headers: {
            'Content-Type': catalog.file.contentType || 'application/pdf',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(catalog.file.fileName)}`,
            'Cache-Control': 'public, max-age=3600',
        },
    });
}
