/**
 * Файлы заказа, отмеченные «для производства» — список для ЦехУспеха.
 *
 * Менеджер отмечает их во вкладке «Для производства» карточки заказа (решение владельца
 * 04.10.2026). Без отметки не уходит ничего: в заказе лежат и внутренние документы, и переписка.
 *
 * Содержимое файла отдаётся отдельным маршрутом (./[id]) — здесь только перечень, чтобы ЦехУспех
 * решал, что ему ещё не хватает, и не тянул одно и то же повторно.
 */
import { NextRequest, NextResponse } from 'next/server';
import { productionFiles } from '@/lib/own-crm/tseh-production-notes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { number: string } }) {
    const key = process.env.TSEH_API_KEY;
    const given = req.headers.get('x-api-key');
    if (!key || !given || given !== key) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 401 });
    }

    const number = decodeURIComponent(params.number);
    const files = await productionFiles(number);

    return NextResponse.json({
        number,
        files: files.map((f) => ({ id: f.id, fileName: f.fileName, contentType: f.contentType, sizeBytes: f.sizeBytes })),
    });
}
