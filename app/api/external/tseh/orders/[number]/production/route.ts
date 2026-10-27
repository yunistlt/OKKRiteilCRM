/**
 * Комментарий менеджера ДЛЯ ЦЕХА — отдельным маршрутом, чтобы ЦехУспех мог перечитать его позже.
 *
 * Комментарий уезжает с заказом один раз, в момент передачи в производство. Но менеджер
 * дописывает его и после: по заказу 52845 текст правился через четыре дня после передачи
 * (Андрей, 27.10.2026 — «файлы и комментарий в цехе остались старыми»). Поэтому ЦехУспех
 * перечитывает его тем же проходом, которым догружает файлы и оплаты.
 *
 * Отдаём только текст из вкладки «Для производства»: переписка менеджера в цех не уходит.
 */
import { NextRequest, NextResponse } from 'next/server';
import { productionComment } from '@/lib/own-crm/tseh-production-notes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { number: string } }) {
    const key = process.env.TSEH_API_KEY;
    const given = req.headers.get('x-api-key');
    if (!key || !given || given !== key) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 401 });
    }

    const number = decodeURIComponent(params.number);
    return NextResponse.json({ number, comment: await productionComment(number) });
}
