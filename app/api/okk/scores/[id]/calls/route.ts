import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { callsOfOrder } from '@/lib/calls-of-order';

export const dynamic = 'force-dynamic';

// GET /api/okk/scores/<id>/calls — звонки по заказу для карточки ОКК.
//
// Привязку звонка к заказу знает сама RetailCRM: выгрузка телефонии отдаёт
// номер заказа, менеджера и запись. Наш матчинг по номеру телефона угадывает
// то же самое и ошибается примерно в трети случаев — он остаётся запасным для
// заказов, которых в выгрузке CRM нет.
//
// Здесь это особенно важно: человек смотрит на список звонков и решает, работал
// менеджер с клиентом или нет. Лишний звонок в списке оправдывает того, кто не
// звонил, а недостающий — обвиняет того, кто звонил.
//
// Поиска по номеру телефона «на всякий случай» тут нет и не было: один номер
// принадлежит десяткам заказов клиента, и такой список выдавал бы чужие
// разговоры за разговоры по этому заказу.

export async function GET(request: Request, { params }: { params: { id: string } }) {
    const orderId = parseInt(params.id, 10);
    if (Number.isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid Order ID' }, { status: 400 });
    }

    try {
        const orderCalls = await callsOfOrder(orderId);
        if (orderCalls.length === 0) return NextResponse.json({ calls: [] });

        // Расшифровка, запись и номера лежат в Телфине — по идентификатору звонка.
        const telphinIds = orderCalls.map((c) => c.telphinCallId).filter(Boolean) as string[];
        const rawById = new Map<string, any>();
        if (telphinIds.length > 0) {
            const { data: raw } = await supabase
                .from('raw_telphin_calls')
                .select(
                    'telphin_call_id, started_at, duration_sec, recording_url, direction, transcript, ' +
                        'from_number, to_number, from_number_normalized, to_number_normalized, raw_payload',
                )
                .in('telphin_call_id', telphinIds);
            for (const r of ((raw ?? []) as any[])) rawById.set(String(r.telphin_call_id), r);
        }

        const calls = orderCalls
            .map((c) => {
                const raw = c.telphinCallId ? rawById.get(c.telphinCallId) : null;
                return {
                    // Данные разговора берём из Телфина, когда он нашёлся: там
                    // запись и расшифровка. Иначе — то, что знает CRM.
                    telphin_call_id: c.telphinCallId,
                    started_at: raw?.started_at ?? c.startedAt,
                    duration_sec: raw?.duration_sec ?? c.durationSec,
                    recording_url: raw?.recording_url ?? null,
                    direction: raw?.direction ?? c.direction,
                    transcript: raw?.transcript ?? null,
                    from_number: raw?.from_number ?? null,
                    to_number: raw?.to_number ?? null,
                    from_number_normalized: raw?.from_number_normalized ?? null,
                    to_number_normalized: raw?.to_number_normalized ?? null,
                    raw_payload: raw?.raw_payload ?? null,
                    // Откуда привязка — это должно быть видно человеку: по
                    // догадке нашего матчинга решения принимать нельзя.
                    call_source: c.source,
                    match_explanation:
                        c.source === 'crm'
                            ? 'Привязка к заказу сделана в RetailCRM'
                            : 'Привязка по номеру телефона нашим матчингом — возможна ошибка',
                    is_fallback: c.source === 'match',
                };
            })
            .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));

        return NextResponse.json({ calls });
    } catch (e: any) {
        console.error('[API Calls] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
