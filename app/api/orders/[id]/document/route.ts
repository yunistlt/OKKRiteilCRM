/**
 * КП и счёт по заказу — PDF, готовый к отправке клиенту.
 *
 * Состав и плательщик берутся из самого заказа, продавец — из реквизитов
 * магазина в RetailCRM. Ничего не вводится руками, поэтому документ всегда
 * соответствует заказу, а цифры в нём раскладываются до позиций.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { orderDocumentData } from '@/lib/own-crm/documents';
import { supabase } from '@/utils/supabase';
import { buildOrderDocumentPdf } from '@/lib/own-crm/order-document-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const kind = new URL(request.url).searchParams.get('kind') === 'invoice' ? 'invoice' : 'proposal';

    /**
     * В маршрут приходит либо идентификатор заказа (кнопки в карточке), либо его
     * НОМЕР — форма письма прикладывает КП по номеру, а у своих заказов он с
     * кириллической «А» («1020А»). Раньше номер молча превращался в NaN, и
     * менеджер получал «Неверный номер заказа» (Ирина 02.10.2026).
     */
    const raw = decodeURIComponent(String(params.id));

    /**
     * Сначала ищем по НОМЕРУ, и только потом считаем, что пришёл id.
     *
     * Свои заказы нумеруются 900089 — число, но не идентификатор (настоящий
     * `order_id` у него 900000089). Проверка «не число — значит номер»
     * работала, пока свои номера были с кириллической «А»; после перехода на
     * шестизначные номер молча уходил в поиск по id, заказ не находился, и
     * кнопка «Приложить КП» давала «Заказ не найден» (Ирина Гордеева
     * 08.10.2026).
     */
    const { data: byNumber } = await supabase
        .from('orders')
        .select('order_id')
        .eq('number', raw)
        .maybeSingle();

    const orderId = Number((byNumber as any)?.order_id ?? raw);
    if (!Number.isFinite(orderId)) {
        return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    // Счёт можно выставить от любого нашего юрлица: их несколько, и у каждого
    // свои реквизиты и своя ставка налога.
    const seller = new URL(request.url).searchParams.get('seller');
    const data = await orderDocumentData(orderId, seller);
    if (!data) {
        return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }
    if (!data.items.length) {
        return NextResponse.json({ error: 'В заказе нет позиций — документ выставлять не из чего' }, { status: 400 });
    }
    if (kind === 'invoice' && !data.seller) {
        return NextResponse.json(
            { error: 'Не знаем реквизиты продавца: магазин заказа не отдаётся справочником RetailCRM' },
            { status: 409 },
        );
    }

    const built = await buildOrderDocumentPdf(data, kind);

    return new NextResponse(new Uint8Array(built.content), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
        },
    });
}
