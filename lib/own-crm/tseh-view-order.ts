/**
 * Данные заказа для просмотра из ЦехУспеха — только чтение.
 *
 * Отдельная выборка, а не переиспользование экранов ОКК: смотрящий из цеха не авторизован у нас,
 * поэтому ему показывается ровно то, что относится к его заказу, и ничего вокруг — ни списка
 * заказов, ни соседних клиентов, ни настроек.
 *
 * Состав и реквизиты берём тем же кодом, что готовит счёт (`orderDocumentData`), чтобы цех видел
 * ровно то же, что клиент видит в документах.
 */
import { supabase } from '@/utils/supabase';
import { orderDocumentData } from '@/lib/own-crm/documents';
import { statusName } from '@/lib/own-crm/history-write';

export type ViewItem = { name: string; quantity: number; price: number; sum: number };

export type OrderView = {
    number: string;
    createdAt: string | null;
    status: string | null;
    customer: string | null;
    customerInn: string | null;
    customerKpp: string | null;
    customerAddress: string | null;
    managerName: string | null;
    productionDays: number | null;
    /** Срок словами: «30 календарных дней» — какие это дни, решает заказ. */
    productionTerm: string | null;
    shippingTerms: string | null;
    managerComment: string | null;
    items: ViewItem[];
    total: number;
    tsehOrderNo: string | null;
    sentToProductionAt: string | null;
};

/** Заказ по его номеру. Нет такого — null, страница ответит 404. */
export async function loadOrderView(number: string): Promise<OrderView | null> {
    const { data: order } = await supabase
        .from('orders')
        .select('id, order_id, number, status, created_at, raw_payload')
        .eq('number', number)
        .maybeSingle();
    if (!order) return null;

    const o = order as any;
    const payload = o.raw_payload || {};
    const doc = await orderDocumentData(Number(o.order_id ?? o.id), null).catch(() => null);

    const items: ViewItem[] = (doc?.items || []).map((it: any) => ({
        name: String(it.name ?? ''),
        quantity: Number(it.quantity ?? 0),
        price: Number(it.price ?? 0),
        sum: Number(it.quantity ?? 0) * Number(it.price ?? 0),
    }));

    // Что ответил ЦехУспех — показываем здесь же: цеху видно, что заказ у них уже заведён.
    const { data: outbox } = await supabase
        .from('tseh_production_outbox')
        .select('tseh_order_no, created_at')
        .eq('order_number', number)
        .maybeSingle();

    return {
        number: String(o.number ?? number),
        createdAt: o.created_at ?? null,
        // Статус — человеческим названием из справочника, а не техническим кодом RetailCRM.
        status: (await statusName(o.status)) || null,
        customer: doc?.payerCompany || doc?.payerName || payload.customer?.nickName || null,
        customerInn: doc?.payerInn || payload.contragent?.INN || null,
        customerKpp: doc?.payerKpp || null,
        customerAddress: doc?.payerAddress || null,
        managerName: doc?.managerName ?? null,
        productionDays: doc?.productionDays ?? null,
        productionTerm: doc?.productionTerm ?? null,
        shippingTerms: doc?.shippingTerms ?? null,
        managerComment: payload.managerComment || null,
        items,
        total: items.reduce((s, it) => s + it.sum, 0),
        tsehOrderNo: (outbox as any)?.tseh_order_no ?? null,
        sentToProductionAt: (outbox as any)?.created_at ?? null,
    };
}
