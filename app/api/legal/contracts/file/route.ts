import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { saveContractFile } from '@/lib/legal/contract-file';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/legal/contracts/file?id=<договор> — скачать договор файлом.
 *
 * Реестр юротдела и карточка заказа отдают один и тот же файл. Если файла ещё
 * нет (договор составлен до того, как мы начали их собирать), он собирается
 * здесь же на лету — человеку не нужно знать, что чего-то не хватало.
 */
export async function GET(req: Request) {
    const session = await getSession();
    // Маршрут живёт под /api/legal, а он открыт админу и юристу. Менеджер
    // берёт тот же файл из «Файлов» заказа — там он лежит обычной записью.
    if (!hasAnyRole(session, ['admin', 'jurist'])) {
        return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'Нужен номер договора' }, { status: 400 });

    const { data } = await supabase
        .from('order_contracts')
        .select('id, order_number, order_id, title, body_text, version, pdf_path')
        .eq('id', Number(id))
        .is('deleted_at', null)
        .maybeSingle();

    const contract = data as any;
    if (!contract) return NextResponse.json({ error: 'Договор не найден' }, { status: 404 });

    let path = contract.pdf_path as string | null;
    if (!path) {
        const built = await saveContractFile({
            contractId: String(contract.id),
            orderNumber: String(contract.order_number),
            orderId: contract.order_id ?? null,
            title: String(contract.title),
            bodyText: String(contract.body_text ?? ''),
            version: contract.version ?? null,
            author: session?.user?.email ?? null,
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
            // inline — договор открывается в браузере, а не скачивается молча.
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
            'Cache-Control': 'private, no-store',
        },
    });
}
