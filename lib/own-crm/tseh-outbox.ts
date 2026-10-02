/**
 * Передача заказа в производство: кладём его в очередь, ЦехУспех забирает сам.
 *
 * Очередь живёт у нас (`tseh_production_outbox`) — решение владельца
 * 02.10.2026. Так никому не нужна запись в чужую боевую базу: мы пишем у себя,
 * ЦехУспех приходит на чтение и забирает по своему расписанию.
 *
 * Строка появляется один раз на заказ: номер заказа уникален, повторный перевод
 * в производство очередь не задваивает.
 */
import { supabase } from '@/utils/supabase';
import { orderDocumentData } from '@/lib/own-crm/documents';

export type OutboxResult =
    | { queued: true; alreadyQueued: boolean }
    | { queued: false; reason: string };

/** Кладёт заказ в очередь на производство. Не бросает: сбой не должен ломать смену статуса. */
export async function queueOrderForProduction(orderId: number): Promise<OutboxResult> {
    try {
        const { data: order } = await supabase
            .from('orders')
            .select('order_id, number, manager_id, raw_payload')
            .eq('order_id', orderId)
            .maybeSingle();

        if (!order) return { queued: false, reason: 'заказ не найден' };

        const orderNumber = String((order as any).number ?? orderId);

        const { data: exists } = await supabase
            .from('tseh_production_outbox')
            .select('id')
            .eq('order_number', orderNumber)
            .maybeSingle();
        if (exists) return { queued: true, alreadyQueued: true };

        // Состав, заказчик и сроки собираем тем же кодом, что готовит счёт —
        // чтобы производство видело ровно то, что видит клиент в документах.
        const data = await orderDocumentData(Number((order as any).order_id), null);
        const payload: any = (order as any).raw_payload || {};

        let managerName: string | null = data?.managerName ?? null;
        if (!managerName && (order as any).manager_id) {
            const { data: manager } = await supabase
                .from('managers')
                .select('first_name, last_name')
                .eq('id', (order as any).manager_id)
                .maybeSingle();
            managerName = [(manager as any)?.last_name, (manager as any)?.first_name].filter(Boolean).join(' ') || null;
        }

        const { error } = await supabase.from('tseh_production_outbox').insert({
            order_number: orderNumber,
            order_id: Number((order as any).order_id),
            customer_name: data?.payerCompany || data?.payerName || payload.customer?.nickName || null,
            customer_inn: data?.payerInn || payload.contragent?.INN || null,
            manager_name: managerName,
            production_days: data?.productionDays ?? null,
            shipping_terms: data?.shippingTerms ?? null,
            items: (data?.items || []).map((item) => ({
                name: item.name,
                quantity: item.quantity,
                price: item.price,
            })),
            total_summ: payload.totalSumm ?? null,
            manager_comment: payload.managerComment || null,
        });

        if (error) {
            console.error('[tseh-outbox] заказ не встал в очередь:', orderNumber, error);
            return { queued: false, reason: error.message };
        }

        return { queued: true, alreadyQueued: false };
    } catch (e: any) {
        console.error('[tseh-outbox] ошибка постановки в очередь:', e?.message || e);
        return { queued: false, reason: String(e?.message || e) };
    }
}
