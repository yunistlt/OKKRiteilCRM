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
    /** Идентификатор записи разговора — из CRM он приходит сразу. */
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

    // Номера заказов: CRM связывает звонок с номером, а не с нашим id.
    const { data: orders } = await supabase.from('orders').select('id, number').in('id', orderIds);
    const idByNumber = new Map<string, number>();
    for (const o of ((orders ?? []) as any[])) idByNumber.set(String(o.number), Number(o.id));

    let crmQuery = supabase
        .from('retailcrm_calls')
        .select('order_number, call_date, duration_sec, call_type, manager_rc_id, record_uuid, external_id')
        .in('order_number', Array.from(idByNumber.keys()));
    if (opts.from) crmQuery = crmQuery.gte('call_date', opts.from);
    if (opts.to) crmQuery = crmQuery.lte('call_date', opts.to);

    const { data: crmCalls } = await crmQuery;
    for (const c of ((crmCalls ?? []) as any[])) {
        const id = idByNumber.get(String(c.order_number));
        if (!id) continue;
        const list = result.get(id) ?? [];
        list.push({
            // Идентификатор Телфина подставится ниже, по записи разговора.
            telphinCallId: null,
            recordUuid: c.external_id ? String(c.external_id) : null,
            startedAt: String(c.call_date),
            durationSec: Number(c.duration_sec ?? 0),
            direction: String(c.call_type) === 'in' ? 'incoming' : 'outgoing',
            managerId: c.manager_rc_id === null || c.manager_rc_id === undefined ? null : Number(c.manager_rc_id),
            source: 'crm',
        });
        result.set(id, list);
    }

    // Идентификатор звонка в Телфине — чтобы достать запись и расшифровку.
    // CRM отдаёт идентификатор ЗАПИСИ, а он лежит внутри массива record_uuids.
    const recordUuids = Array.from(result.values())
        .flat()
        .map((c) => c.recordUuid)
        .filter(Boolean) as string[];
    if (recordUuids.length > 0) {
        const byUuid = new Map<string, string>();
        for (let i = 0; i < recordUuids.length; i += 100) {
            const { data: raw } = await supabase
                .from('raw_telphin_calls')
                .select('telphin_call_id, record_uuids')
                .overlaps('record_uuids', recordUuids.slice(i, i + 100));
            for (const r of ((raw ?? []) as any[])) {
                for (const u of (r.record_uuids ?? []) as string[]) byUuid.set(String(u), String(r.telphin_call_id));
            }
        }
        for (const list of Array.from(result.values())) {
            for (const call of list) {
                if (call.recordUuid) call.telphinCallId = byUuid.get(call.recordUuid) ?? null;
            }
        }
    }

    // Костыль — только для заказов, про которые CRM ничего не сказала.
    const missing = orderIds.filter((id) => !result.has(id));
    if (missing.length === 0) return result;

    const { data: matches } = await supabase
        .from('call_order_matches')
        .select('retailcrm_order_id, telphin_call_id')
        .in('retailcrm_order_id', missing);
    const callIds = ((matches ?? []) as any[]).map((m) => String(m.telphin_call_id));
    if (callIds.length === 0) return result;

    const orderByCall = new Map<string, number>();
    for (const m of ((matches ?? []) as any[])) orderByCall.set(String(m.telphin_call_id), Number(m.retailcrm_order_id));

    // Порциями: тысячи идентификаторов в один запрос не влезают.
    for (let i = 0; i < callIds.length; i += 200) {
        let q = supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, started_at, duration_sec, direction, record_uuids')
            .in('telphin_call_id', callIds.slice(i, i + 200));
        if (opts.from) q = q.gte('started_at', opts.from);
        if (opts.to) q = q.lte('started_at', opts.to);

        const { data: calls } = await q;
        for (const c of ((calls ?? []) as any[])) {
            const id = orderByCall.get(String(c.telphin_call_id));
            if (!id) continue;
            const list = result.get(id) ?? [];
            list.push({
                telphinCallId: String(c.telphin_call_id),
                recordUuid: Array.isArray(c.record_uuids) ? String(c.record_uuids[0] ?? '') || null : null,
                startedAt: String(c.started_at),
                durationSec: Number(c.duration_sec ?? 0),
                direction: c.direction === 'incoming' ? 'incoming' : 'outgoing',
                managerId: null,
                source: 'match',
            });
            result.set(id, list);
        }
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
    // Идентификаторы записей этого звонка — по ним CRM его и знает.
    const { data: call } = await supabase
        .from('raw_telphin_calls')
        .select('record_uuids')
        .eq('telphin_call_id', telphinCallId)
        .maybeSingle();

    const uuids = ((call as any)?.record_uuids ?? []) as string[];
    if (uuids.length > 0) {
        const { data: crm } = await supabase
            .from('retailcrm_calls')
            .select('order_number')
            .in('external_id', uuids)
            .not('order_number', 'is', null)
            .limit(1);
        const number = ((crm ?? []) as any[])[0]?.order_number;
        if (number) {
            const { data: order } = await supabase
                .from('orders')
                .select('id')
                .eq('number', String(number))
                .maybeSingle();
            if (order) return { orderId: Number((order as any).id), source: 'crm' };
        }
    }

    // Костыль: наш матчинг. Ошибается примерно в трети случаев, поэтому
    // спрашивается последним и помечается источником.
    const { data: match } = await supabase
        .from('call_order_matches')
        .select('retailcrm_order_id')
        .eq('telphin_call_id', telphinCallId)
        .limit(1)
        .maybeSingle();
    if ((match as any)?.retailcrm_order_id) {
        return { orderId: Number((match as any).retailcrm_order_id), source: 'match' };
    }
    return null;
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
