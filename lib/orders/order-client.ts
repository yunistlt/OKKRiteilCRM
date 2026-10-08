import { supabase } from '@/utils/supabase';

/**
 * Клиент заказа: имя и номер карточки.
 *
 * Нужен оповещениям — письмо, задача и звонок показывают заказ, но не говорят,
 * чей он. Владелец 08.10.2026: «сделай, чтобы в оповещении ещё и клиент был
 * кликабельным» — то же, что сделано в реестре звонков.
 *
 * Имя берём как и везде: название компании, затем юрлицо, затем контактное
 * лицо. Карточка — `orders.customer`, закон проекта.
 */
export type OrderClient = { clientId: number | null; clientName: string | null };

export async function clientsByOrderNumbers(numbers: string[]): Promise<Map<string, OrderClient>> {
    const result = new Map<string, OrderClient>();
    const unique = Array.from(new Set(numbers.map(String).filter(Boolean)));
    if (!unique.length) return result;

    const { data, error } = await supabase
        .from('orders')
        .select('number, customer, raw_payload')
        .in('number', unique);

    if (error) {
        console.warn('[order-client] клиент заказа не прочитался:', error.message);
        return result;
    }

    for (const row of ((data ?? []) as any[])) {
        const payload = row.raw_payload ?? {};
        const customer = row.customer ?? payload.customer ?? {};
        const rawId = customer?.id;
        const clientId = typeof rawId === 'number' || /^\d+$/.test(String(rawId ?? ''))
            ? Number(rawId)
            : null;

        const clientName = customer?.nickName
            || payload.contragent?.legalName
            || [payload.firstName, payload.lastName].filter(Boolean).join(' ').trim()
            || null;

        result.set(String(row.number), { clientId, clientName: clientName || null });
    }

    return result;
}
