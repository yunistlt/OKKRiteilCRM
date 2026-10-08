import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { buildContractKit } from '@/lib/legal/contract-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Комплект по заказу: счёт + договор + спецификация одним файлом.
 *
 * `GET /api/orders/<номер>/contract/kit?id=<договор>` — собрать и отдать.
 * Файл заодно ложится в «Файлы» заказа, чтобы его можно было приложить к
 * письму галочкой, а не пересохранять на компьютер.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));
    const contractId = new URL(req.url).searchParams.get('id') || '';
    if (!contractId) return NextResponse.json({ error: 'Нужен номер договора' }, { status: 400 });

    const { data: contract } = await supabase
        .from('order_contracts')
        .select('id, order_number, order_id, title, body_text')
        .eq('id', Number(contractId))
        .is('deleted_at', null)
        .maybeSingle();

    const row = contract as any;
    if (!row || String(row.order_number) !== orderNumber) {
        return NextResponse.json({ error: 'Договор не найден' }, { status: 404 });
    }

    // Номер своего заказа — число, но не идентификатор: ищем заказ по номеру.
    const { data: order } = await supabase
        .from('orders')
        .select('order_id')
        .eq('number', orderNumber)
        .maybeSingle();

    const orderId = Number((order as any)?.order_id ?? row.order_id);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

    const kit = await buildContractKit({
        orderId,
        orderNumber,
        contractId: row.id,
        contractTitle: String(row.title),
        contractText: String(row.body_text ?? ''),
        author: session.user.email || session.user.username || null,
    });

    if (!kit.ok) return NextResponse.json({ error: kit.reason }, { status: 400 });

    const stored = await supabase.storage.from('okk-assets').download(kit.path);
    if (stored.error || !stored.data) {
        return NextResponse.json({ error: 'Комплект собрался, но не читается' }, { status: 502 });
    }

    const bytes = Buffer.from(await stored.data.arrayBuffer());
    return new NextResponse(bytes, {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(kit.fileName)}`,
            'Cache-Control': 'private, no-store',
        },
    });
}
