import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

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
    if (search) query = query.or(`phone.ilike.%${search}%,order_number.ilike.%${search}%,manager_name.ilike.%${search}%`);

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
