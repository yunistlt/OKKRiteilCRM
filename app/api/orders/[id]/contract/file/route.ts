import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { saveContractFile } from '@/lib/legal/contract-file';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/orders/<номер>/contract/file?id=<договор> — договор файлом для менеджера.
 *
 * Тот же файл, что лежит во вкладке «Файлы» заказа; здесь он открывается сразу
 * после составления, не заставляя человека искать вкладку. Маршрут внутри
 * /api/orders — значит, доступен тем же ролям, что и сам заказ.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id: orderNumber } = await params;
    const contractId = new URL(req.url).searchParams.get('id') || '';
    if (!contractId) return NextResponse.json({ error: 'Нужен номер договора' }, { status: 400 });

    const { data } = await supabase
        .from('order_contracts')
        .select('id, order_number, order_id, title, body_text, version, pdf_path')
        .eq('id', Number(contractId))
        .is('deleted_at', null)
        .maybeSingle();

    const contract = data as any;
    // Договор чужого заказа по ссылке не отдаём.
    if (!contract || String(contract.order_number) !== decodeURIComponent(String(orderNumber))) {
        return NextResponse.json({ error: 'Договор не найден' }, { status: 404 });
    }

    let path = contract.pdf_path as string | null;
    if (!path) {
        const built = await saveContractFile({
            contractId: String(contract.id),
            orderNumber: String(contract.order_number),
            orderId: contract.order_id ?? null,
            title: String(contract.title),
            bodyText: String(contract.body_text ?? ''),
            version: contract.version ?? null,
            author: session.user.email || session.user.username || null,
        });
        if (!built.ok) return NextResponse.json({ error: `Файл не собрался: ${built.reason}` }, { status: 502 });
        path = built.path;
    }

    const stored = await supabase.storage.from('okk-assets').download(path);
    if (stored.error || !stored.data) {
        return NextResponse.json({ error: 'Файл договора не читается' }, { status: 502 });
    }

    const bytes = Buffer.from(await stored.data.arrayBuffer());
    const name = `Договор №${contract.order_number}.pdf`;
    return new NextResponse(bytes, {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
            'Cache-Control': 'private, no-store',
        },
    });
}
