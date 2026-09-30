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
import { generateInvoicePDF, generateProposalPDF } from '@/lib/pdf-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: { id: string } }) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const kind = new URL(request.url).searchParams.get('kind') === 'invoice' ? 'invoice' : 'proposal';
    const orderId = Number(params.id);
    if (!Number.isFinite(orderId)) {
        return NextResponse.json({ error: 'Неверный номер заказа' }, { status: 400 });
    }

    const data = await orderDocumentData(orderId);
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

    const items = data.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
    }));

    const pdf = kind === 'invoice'
        ? await generateInvoicePDF({
            invoice_number: data.orderNumber,
            title: `Счёт по заказу №${data.orderNumber}`,
            items,
            discount_pct: 0,
            vat_pct: 20,
            payer_company: data.payerCompany || undefined,
            payer_name: data.payerName || undefined,
            payer_inn: data.payerInn || undefined,
            payer_kpp: data.payerKpp || undefined,
            payer_address: data.payerAddress || undefined,
            seller_name: data.seller?.name,
            seller_inn: data.seller?.inn,
            seller_kpp: data.seller?.kpp,
            seller_bank: data.seller?.bank,
            seller_bik: data.seller?.bik,
            seller_ks: data.seller?.ks,
            seller_rs: data.seller?.rs,
            seller_address: data.seller?.address,
        })
        : await generateProposalPDF({
            title: `Коммерческое предложение по заказу №${data.orderNumber}`,
            items,
            discount_pct: 0,
            client_company: data.payerCompany || undefined,
            client_name: data.payerName || undefined,
        });

    const fileName = kind === 'invoice'
        ? `Счёт №${data.orderNumber}.pdf`
        : `КП №${data.orderNumber}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
    });
}
