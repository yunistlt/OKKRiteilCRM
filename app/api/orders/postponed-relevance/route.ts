import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPostponedRelevanceCandidates } from '@/lib/order-relevance-email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Список заказов в статусе «Отложено», переведённых туда за период (для рассылки писем
 * об актуальности). Доступ: admin/rop. Параметры: managerId, from (ISO/дата), to.
 */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session || !['admin', 'rop'].includes(session.user.role)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const managerIdRaw = url.searchParams.get('managerId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) {
        return NextResponse.json({ error: 'from/to required (ISO dates)' }, { status: 400 });
    }

    const candidates = await getPostponedRelevanceCandidates({
        managerId: managerIdRaw ? Number(managerIdRaw) : undefined,
        movedFrom: from,
        movedTo: to,
        limit: 200,
    });

    // Не тянем в список полный reasonText/html — только то, что нужно для таблицы.
    const rows = candidates.map((c) => ({
        orderId: c.orderId,
        number: c.number,
        total: c.total,
        customerName: c.customerName,
        contactName: c.contactName,
        toEmail: c.toEmail,
        movedAt: c.movedAt,
        itemsCount: c.items.length,
        reasonSnippet: (c.reasonText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }));

    return NextResponse.json({ ok: true, count: rows.length, candidates: rows });
}
