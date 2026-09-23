import { supabase } from '@/utils/supabase';

/**
 * Звонки по заказу — одно место на весь проект.
 *
 * Источников два, и они неравноценны.
 *
 * `retailcrm_calls` — выгрузка телефонии из RetailCRM. Привязку к заказу сделала
 * сама CRM, там же, где работает менеджер: номер заказа, менеджер, время
 * разговора, идентификатор записи. Это источник правды.
 *
 * `call_order_matches` — наш матчинг по номеру телефона. Он угадывает то, что
 * CRM знает, и ошибается примерно в трети случаев: на 22 сентября он «нашёл»
 * звонки по 79 заказам там, где CRM знает про 56, и разница — выдуманные
 * совпадения. Остаётся костылём для заказов, которых в выгрузке нет.
 *
 * Цена ошибки не абстрактная: по этим данным решают, кто работал с клиентом, а
 * кто закрыл заказ молча, — и кому за это платить.
 *
 * Отдельная ловушка, из-за которой этот модуль и появился: в матчинге есть поле
 * `matched_at` — время СОПОСТАВЛЕНИЯ, а не разговора. За тридцать дней у 1499 из
 * 2365 сопоставлений оно расходилось с датой звонка, средний отрыв — 99 часов.
 * Здесь время всегда берётся из самого звонка.
 */

export type OrderCall = {
    /**
     * Идентификатор в Телфине: по нему лежат запись и расшифровка.
     *
     * У звонка из CRM его нет напрямую — связь идёт через идентификатор записи:
     * `retailcrm_calls.external_id` лежит внутри массива
     * `raw_telphin_calls.record_uuids`. Сходится 13 571 звонок из 18 909, и
     * почти все они с расшифровкой.
     */
    telphinCallId: string | null;
    /**
     * Идентификатор записи разговора. Связь звонка с заказом уже разрешена в
     * представлении, поэтому здесь он больше не нужен и остаётся null.
     */
    recordUuid: string | null;
    startedAt: string;
    durationSec: number;
    direction: 'incoming' | 'outgoing';
    managerId: number | null;
    /** Откуда привязка: 'crm' — точно, 'match' — наша догадка. */
    source: 'crm' | 'match';
};

/**
 * Звонки по заказам за период.
 *
 * По каждому заказу отдаются данные ОДНОГО источника: если CRM знает про этот
 * заказ, берётся она целиком. Смешивать нельзя — один разговор пришёл бы дважды
 * и удвоил бы активность.
 */
export async function callsByOrders(
    orderIds: number[],
    opts: { from?: string; to?: string } = {},
): Promise<Map<number, OrderCall[]>> {
    const result = new Map<number, OrderCall[]>();
    if (orderIds.length === 0) return result;

    // Связь живёт представлением в базе: какой источник главный, решено там
    // один раз, и все потребители видят одно и то же. Раньше эта развилка была
    // здесь, в коде, и повторялась в каждом месте, которое читало звонки.
    const rows: any[] = [];
    for (let i = 0; i < orderIds.length; i += 300) {
        let q = supabase
            .from('call_order_link')
            .select('order_id, telphin_call_id, started_at, duration_sec, direction, manager_id, source')
            .in('order_id', orderIds.slice(i, i + 300));
        if (opts.from) q = q.gte('started_at', opts.from);
        if (opts.to) q = q.lte('started_at', opts.to);

        const { data } = await q;
        rows.push(...((data ?? []) as any[]));
    }

    for (const r of rows) {
        const list = result.get(Number(r.order_id)) ?? [];
        list.push({
            telphinCallId: r.telphin_call_id ? String(r.telphin_call_id) : null,
            recordUuid: null,
            startedAt: String(r.started_at),
            durationSec: Number(r.duration_sec ?? 0),
            direction: r.direction === 'incoming' ? 'incoming' : 'outgoing',
            managerId: r.manager_id === null || r.manager_id === undefined ? null : Number(r.manager_id),
            source: r.source === 'crm' ? 'crm' : 'match',
        });
        result.set(Number(r.order_id), list);
    }

    return result;
}

/**
 * Какому заказу принадлежит звонок.
 *
 * Обратный ход: расшифровали звонок — надо понять, по какому он заказу, чтобы
 * запустить разбор. Спрашиваем сначала CRM (она знает точно), потом наш
 * матчинг.
 */
export async function orderOfCall(telphinCallId: string): Promise<{ orderId: number; source: 'crm' | 'match' } | null> {
    // Развилка «CRM или матчинг» разрешена в представлении, и порядок там же:
    // строка из CRM идёт первой, наша догадка подставляется, только если CRM
    // про этот заказ промолчала.
    const { data } = await supabase
        .from('call_order_link')
        .select('order_id, source')
        .eq('telphin_call_id', telphinCallId)
        .order('source', { ascending: true }) // 'crm' раньше 'match' по алфавиту
        .limit(1);

    const row = ((data ?? []) as any[])[0];
    if (!row) return null;
    return { orderId: Number(row.order_id), source: row.source === 'crm' ? 'crm' : 'match' };
}

/** Звонки по одному заказу. */
export async function callsOfOrder(orderId: number, opts: { from?: string; to?: string } = {}): Promise<OrderCall[]> {
    const map = await callsByOrders([orderId], opts);
    return map.get(orderId) ?? [];
}

/**
 * Схлопывание попыток в разговоры.
 *
 * Один звонок через очередь даёт несколько строк: очередь звонит нескольким
 * сразу, и каждая попытка пишется отдельно. Без схлопывания активность выглядит
 * втрое выше, чем была.
 */
export function collapseCalls(calls: OrderCall[]): OrderCall[] {
    const sorted = [...calls].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const out: OrderCall[] = [];
    for (const call of sorted) {
        const prev = out[out.length - 1];
        const gap = prev ? new Date(call.startedAt).getTime() - new Date(prev.startedAt).getTime() : Infinity;
        // Две минуты: попытки дозвона внутри очереди укладываются в это окно,
        // а следующий самостоятельный звонок — уже нет.
        if (prev && gap < 2 * 60_000) {
            // Из попыток разговором была самая длинная.
            if (call.durationSec > prev.durationSec) {
                prev.durationSec = call.durationSec;
                prev.recordUuid = call.recordUuid ?? prev.recordUuid;
                prev.telphinCallId = call.telphinCallId ?? prev.telphinCallId;
            }
            continue;
        }
        out.push({ ...call });
    }
    return out;
}
