import { NextResponse } from 'next/server';
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
    const extras = new Map<string, { recordingUrl: string | null; transcript: string | null }>();
    if (uuids.length) {
        const { data: telphin } = await supabase
            .from('raw_telphin_calls')
            .select('record_uuids, recording_url, transcript')
            .overlaps('record_uuids', uuids);
        for (const row of ((telphin || []) as any[])) {
            for (const uuid of row.record_uuids || []) {
                extras.set(String(uuid), { recordingUrl: row.recording_url ?? null, transcript: row.transcript ?? null });
            }
        }
    }

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
            };
        }),
    });
}
