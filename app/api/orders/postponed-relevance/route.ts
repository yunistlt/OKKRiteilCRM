import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
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

    // Какие из этих заказов уже получали письмо (реестр отправок) — чтобы пометить в списке.
    const numbers = candidates.map((c) => c.number);
    const sentMap = new Map<string, string>(); // order_number -> последняя дата отправки
    if (numbers.length) {
        const { data: sends } = await supabase
            .from('order_email_sends')
            .select('order_number, created_at')
            .in('order_number', numbers)
            .order('created_at', { ascending: false });
        for (const s of (sends || []) as Array<{ order_number: string; created_at: string }>) {
            if (!sentMap.has(s.order_number)) sentMap.set(s.order_number, s.created_at);
        }
    }

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
        lastSentAt: sentMap.get(c.number) || null,
    }));

    return NextResponse.json({ ok: true, count: rows.length, candidates: rows });
}
