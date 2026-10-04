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
import { orderInn } from '@/lib/own-crm/inn-gate';
import { productionComment } from '@/lib/own-crm/tseh-production-notes';

export type OutboxResult =
    | { queued: true; alreadyQueued: boolean }
    | { queued: false; reason: string };

/**
 * ИНН заказчика — 10 цифр у организации, 12 у предпринимателя.
 *
 * ЦехУспех ищет заказчика только по ИНН: завод работает с юрлицами, и дубли по
 * ИНН там запрещены. Без ИНН заказ туда не заведётся, поэтому говорим об этом
 * менеджеру сразу, а не после отказа (согласовано 04.10.2026).
 */
function innProblem(raw: unknown): string | null {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 12) return null;
    return 'У заказчика нет корректного ИНН. ЗМК работает только с юрлицами — '
        + 'заполните ИНН в карточке клиента и передайте заказ заново.';
}

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

        // ИНН спрашиваем там же, где его правит менеджер — в карточке клиента.
        const customerInn = (await orderInn(Number((order as any).order_id))) || data?.payerInn || null;
        const problem = innProblem(customerInn);
        if (problem) return { queued: false, reason: problem };

        const { error } = await supabase.from('tseh_production_outbox').insert({
            order_number: orderNumber,
            order_id: Number((order as any).order_id),
            customer_name: data?.payerCompany || data?.payerName || payload.customer?.nickName || null,
            customer_inn: customerInn,
            manager_name: managerName,
            production_days: data?.productionDays ?? null,
            shipping_terms: data?.shippingTerms ?? null,
            items: (data?.items || []).map((item) => ({
                name: item.name,
                quantity: item.quantity,
                price: item.price,
            })),
            total_summ: payload.totalSumm ?? null,
            // В цех уходит ТОЛЬКО то, что менеджер написал во вкладке «Для производства»
            // (решение владельца 04.10.2026). Комментарий менеджера по заказу туда больше не
            // передаём: там бывает внутренняя кухня — согласования и договорённости по цене.
            manager_comment: await productionComment(orderNumber),
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
