import { NextResponse } from 'next/server';
import { knownClientPhones, phoneKey } from '@/lib/calls/known-numbers';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { clientCallKeys } from '@/lib/calls-client-search';

export const dynamic = 'force-dynamic';

/**
 * Общий список звонков — для раздела «Звонки».
 *
 * Источник — НАШИ звонки из Телфина (`raw_telphin_calls`). Раньше список
 * строился по `retailcrm_calls`: привязку к заказу делала сама RetailCRM. С
 * 09.10.2026 синхронизация с ней снята (живём в ОКК), и список встал — 12.10
 * менеджеры увидели «Звонков не найдено» за сегодняшний день при живой
 * телефонии.
 *
 * Привязку к заказу и менеджера берём, в порядке надёжности:
 *  1. `retailcrm_calls` — для старых звонков, где это уже посчитала CRM;
 *  2. наш матчинг `call_order_matches` — для новых;
 *  3. добавочный номер из записи звонка → менеджер из справочника.
 *
 * Запись разговора и расшифровка лежат в той же строке Телфина.
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
        .from('raw_telphin_calls')
        .select('telphin_call_id, direction, from_number, to_number, from_number_normalized, to_number_normalized, started_at, duration_sec, recording_url, transcript, record_uuids, manager_extension')
        .order('started_at', { ascending: false })
        .limit(limit);

    if (directionParam === 'in') query = query.eq('direction', 'incoming');
    if (directionParam === 'out') query = query.eq('direction', 'outgoing');
    // «Без ответа» — разговора не было: нулевая длительность.
    if (missed === '1') query = query.eq('duration_sec', 0);
    if (from) query = query.gte('started_at', `${from}T00:00:00+03:00`);
    if (to) query = query.lte('started_at', `${to}T23:59:59+03:00`);
    if (Number.isFinite(minSec)) query = query.gte('duration_sec', minSec);
    if (Number.isFinite(maxSec)) query = query.lte('duration_sec', maxSec);

    if (search) {
        /**
         * Ищем и по наименованию клиента: названия у звонка нет, поэтому по
         * нему сначала находим клиентов, а затем их телефоны (просьба Евгении
         * 05.10.2026).
         */
        const keys = await clientCallKeys(search);
        const digits = search.replace(/\D/g, '');
        const parts = [
            `from_number.ilike.%${search}%`,
            `to_number.ilike.%${search}%`,
        ];
        if (digits.length >= 4) {
            parts.push(`from_number_normalized.ilike.%${digits}%`);
            parts.push(`to_number_normalized.ilike.%${digits}%`);
        }
        if (keys.phones.length) {
            parts.push(`from_number_normalized.in.(${keys.phones.join(',')})`);
            parts.push(`to_number_normalized.in.(${keys.phones.join(',')})`);
        }
        query = query.or(parts.join(','));
    }

    const { data, error } = await query;
    if (error) {
        console.error('[calls] список не прочитался:', error);
        return NextResponse.json({ error: 'Не удалось прочитать звонки' }, { status: 500 });
    }

    const rows = (data || []) as any[];

    /** Номер собеседника: у входящего звонит он, у исходящего звоним мы. */
    const partyPhone = (row: any): string =>
        String((row.direction === 'incoming' ? row.from_number : row.to_number) ?? '');

    /**
     * Добавочный сотрудника лежит колонкой: ноги разговора разбираются один
     * раз при приёме звонка. Разбирать их на каждом показе значило тянуть
     * мегабайты — список собирался 7,5 секунды (12.10.2026).
     */
    const extensionOf = (row: any): string => String(row.manager_extension ?? '').trim();

    const callIds = rows.map((row) => String(row.telphin_call_id));
    const uuids = rows.flatMap((row) => (Array.isArray(row.record_uuids) ? row.record_uuids : [])).filter(Boolean);

    /**
     * Что знает про эти звонки RetailCRM: для старых звонков привязка к заказу
     * и менеджер там уже посчитаны, и это надёжнее нашего матчинга.
     */
    const fromCrm = new Map<string, { orderNumber: string | null; managerName: string | null }>();
    if (uuids.length) {
        const { data: crm } = await supabase
            .from('retailcrm_calls')
            .select('external_id, order_number, manager_name')
            .in('external_id', uuids);

        const byUuid = new Map(((crm ?? []) as any[]).map((r) => [String(r.external_id), r]));
        for (const row of rows) {
            for (const uuid of (row.record_uuids ?? [])) {
                const hit = byUuid.get(String(uuid));
                if (hit) {
                    fromCrm.set(String(row.telphin_call_id), {
                        orderNumber: hit.order_number ? String(hit.order_number) : null,
                        managerName: hit.manager_name ?? null,
                    });
                    break;
                }
            }
        }
    }

    /** Наши привязки: подтверждённые — это заказ звонка, «подсказка» — только подсказка. */
    const matched = new Map<string, { orderId: number; number: string }>();
    const suggested = new Map<string, { orderId: number; number: string }>();
    if (callIds.length) {
        const { data: links } = await supabase
            .from('call_order_matches')
            .select('telphin_call_id, retailcrm_order_id, match_type')
            .in('telphin_call_id', callIds);

        const linkRows = (links ?? []) as any[];
        if (linkRows.length) {
            const { data: orderRows } = await supabase
                .from('orders')
                .select('id, number')
                .in('id', Array.from(new Set(linkRows.map((l) => l.retailcrm_order_id))));

            const numbers = new Map(((orderRows ?? []) as any[]).map((o) => [Number(o.id), String(o.number)]));
            for (const link of linkRows) {
                const number = numbers.get(Number(link.retailcrm_order_id));
                if (!number) continue;
                const target = String(link.match_type) === 'ai_suggested' ? suggested : matched;
                target.set(String(link.telphin_call_id), { orderId: Number(link.retailcrm_order_id), number });
            }
        }
    }

    /** Кто говорил: по добавочному из записи звонка. */
    const byExtension = new Map<string, string>();
    const extensions = Array.from(new Set(rows.map(extensionOf).filter(Boolean)));
    if (extensions.length) {
        const { data: managers } = await supabase
            .from('managers')
            .select('first_name, last_name, telphin_extension')
            .in('telphin_extension', extensions);

        for (const manager of ((managers ?? []) as any[])) {
            byExtension.set(
                String(manager.telphin_extension).trim(),
                [manager.last_name, manager.first_name].filter(Boolean).join(' '),
            );
        }
    }

    /**
     * Можно ли звонить по номеру из реестра. Звоним ТОЛЬКО на номера из
     * карточек клиентов (решение владельца 08.10.2026): в реестре полно
     * автоответчиков, переадресаций и чужих номеров.
     */
    const known = await knownClientPhones(rows.map(partyPhone)).catch(() => new Map());

    return NextResponse.json({
        calls: rows.map((row) => {
            const id = String(row.telphin_call_id);
            const phone = partyPhone(row);
            const crm = fromCrm.get(id);
            const ourOrder = matched.get(id);

            return {
                id,
                date: row.started_at,
                direction: row.direction === 'incoming' ? 'Входящий' : 'Исходящий',
                phone,
                managerName: crm?.managerName ?? byExtension.get(extensionOf(row)) ?? null,
                orderNumber: crm?.orderNumber ?? ourOrder?.number ?? null,
                missed: Number(row.duration_sec ?? 0) === 0,
                durationSec: row.duration_sec ?? 0,
                recordingUrl: row.recording_url ?? null,
                hasTranscript: !!row.transcript,
                transcript: row.transcript ?? null,
                callId: id,
                suggestedOrder: suggested.get(id) ?? null,
                // Номер есть в карточке клиента — значит, кнопка «позвонить»
                // и ссылка на саму карточку.
                knownClientId: known.get(phoneKey(phone) ?? '')?.clientId ?? null,
                clientName: known.get(phoneKey(phone) ?? '')?.name ?? null,
                knownPhone: known.has(phoneKey(phone) ?? ''),
            };
        }),
    });
}
