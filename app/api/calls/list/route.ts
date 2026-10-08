import { NextResponse } from 'next/server';
import { knownClientPhones, phoneKey } from '@/lib/calls/known-numbers';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { clientCallKeys } from '@/lib/calls-client-search';

export const dynamic = 'force-dynamic';

/**
 * Общий список звонков — для раздела «Звонки».
 *
 * Источник — `retailcrm_calls`: привязку звонка к заказу и менеджеру сделала сама
 * RetailCRM, там же, где работает человек. Наш матчинг по номеру телефона
 * (`call_order_matches`) ошибается примерно в трети случаев и в общий список не
 * идёт — закон проекта, см. `lib/calls-of-order.ts`.
 *
 * Запись разговора и расшифровку добираем из `raw_telphin_calls` по
 * идентификатору записи.
 */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(500, Math.max(20, parseInt(searchParams.get('limit') || '200', 10)));
    const directionParam = searchParams.get('direction') || 'all'; // all | in | out
    const missed = searchParams.get('missed'); // '1' — только без ответа
    const search = (searchParams.get('search') || '').trim();
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    // Длительность в секундах: менеджер ищет разговор, а не гудки.
    const minSec = parseInt(searchParams.get('minSec') || '', 10);
    const maxSec = parseInt(searchParams.get('maxSec') || '', 10);

    let query = supabase
        .from('retailcrm_calls')
        .select('rc_call_id, external_id, call_type, call_date, manager_name, manager_rc_id, phone, order_number, is_missed, duration_sec')
        .order('call_date', { ascending: false })
        .limit(limit);

    if (directionParam === 'in') query = query.eq('call_type', 'in');
    if (directionParam === 'out') query = query.eq('call_type', 'out');
    if (missed === '1') query = query.eq('is_missed', true);
    if (from) query = query.gte('call_date', `${from}T00:00:00+03:00`);
    if (to) query = query.lte('call_date', `${to}T23:59:59+03:00`);
    if (Number.isFinite(minSec)) query = query.gte('duration_sec', minSec);
    if (Number.isFinite(maxSec)) query = query.lte('duration_sec', maxSec);
    if (search) {
        /**
         * Ищем ещё и по наименованию клиента — как в RetailCRM (просьба Евгении
         * 05.10.2026). Названия у звонка нет, поэтому по нему сначала находим
         * клиентов, а затем их заказы, контактных лиц и телефоны.
         */
        const keys = await clientCallKeys(search);
        const parts = [
            `phone.ilike.%${search}%`,
            `order_number.ilike.%${search}%`,
            `manager_name.ilike.%${search}%`,
        ];
        if (keys.orderNumbers.length) parts.push(`order_number.in.(${keys.orderNumbers.join(',')})`);
        if (keys.customerIds.length) parts.push(`customer_rc_id.in.(${keys.customerIds.join(',')})`);
        if (keys.phones.length) parts.push(`phone_normalized.in.(${keys.phones.join(',')})`);
        query = query.or(parts.join(','));
    }

    const { data, error } = await query;
    if (error) {
        console.error('[calls] список не прочитался:', error);
        return NextResponse.json({ error: 'Не удалось прочитать звонки' }, { status: 500 });
    }

    const rows = (data || []) as any[];
    const uuids = rows.map((r) => r.external_id).filter(Boolean);

    // Запись и расшифровка лежат у Телфина. Связь идёт по `external_id` из CRM
    // («469589-7b6e…»): именно он лежит в массиве `record_uuids`, а поле
    // `record_uuid` — только его хвост, по нему ничего не сходится.
    const extras = new Map<string, { recordingUrl: string | null; transcript: string | null; callId: string | null }>();
    const callIds: string[] = [];
    if (uuids.length) {
        const { data: telphin } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, record_uuids, recording_url, transcript')
            .overlaps('record_uuids', uuids);
        for (const row of ((telphin || []) as any[])) {
            callIds.push(String(row.telphin_call_id));
            for (const uuid of row.record_uuids || []) {
                extras.set(String(uuid), {
                    recordingUrl: row.recording_url ?? null,
                    transcript: row.transcript ?? null,
                    callId: String(row.telphin_call_id),
                });
            }
        }
    }

    /**
     * Подсказанные заказы: разбор разговора нашёл в тексте номер заказа, но
     * привязкой это станет только после подтверждения человеком (решение
     * владельца 05.10.2026 — угадывать мы перестали).
     */
    const suggested = new Map<string, { orderId: number; number: string }>();
    if (callIds.length) {
        const { data: hints } = await supabase
            .from('call_order_matches')
            .select('telphin_call_id, retailcrm_order_id')
            .eq('match_type', 'ai_suggested')
            .in('telphin_call_id', callIds);

        const hintRows = (hints || []) as any[];
        if (hintRows.length) {
            const { data: orderRows } = await supabase
                .from('orders')
                .select('id, number')
                .in('id', hintRows.map((h) => h.retailcrm_order_id));
            const numbers = new Map(((orderRows || []) as any[]).map((o) => [Number(o.id), String(o.number)]));
            for (const hint of hintRows) {
                const number = numbers.get(Number(hint.retailcrm_order_id));
                if (number) suggested.set(String(hint.telphin_call_id), { orderId: Number(hint.retailcrm_order_id), number });
            }
        }
    }

    /**
     * Можно ли звонить по номеру из реестра. Звоним ТОЛЬКО на номера из
     * карточек клиентов (решение владельца 08.10.2026): в реестре полно
     * автоответчиков, переадресаций и чужих номеров.
     */
    const known = await knownClientPhones(rows.map((r: any) => r.phone)).catch(() => new Map<string, number>());

    return NextResponse.json({
        calls: rows.map((row) => {
            const extra = row.external_id ? extras.get(String(row.external_id)) : undefined;
            return {
                id: row.rc_call_id,
                date: row.call_date,
                direction: row.call_type === 'in' ? 'Входящий' : 'Исходящий',
                phone: row.phone,
                managerName: row.manager_name,
                orderNumber: row.order_number,
                missed: !!row.is_missed,
                durationSec: row.duration_sec ?? 0,
                recordingUrl: extra?.recordingUrl ?? null,
                hasTranscript: !!extra?.transcript,
                transcript: extra?.transcript ?? null,
                callId: extra?.callId ?? null,
                suggestedOrder: extra?.callId ? (suggested.get(extra.callId) ?? null) : null,
                // Номер есть в карточке клиента — значит, кнопка «позвонить».
                knownClientId: known.get(phoneKey(row.phone) ?? '') ?? null,
            };
        }),
    });
}
