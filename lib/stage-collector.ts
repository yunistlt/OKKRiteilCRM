// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Сбор улик и истории изменений заказа из RetailCRM.
import { supabase } from '@/utils/supabase';
import { fetchOrderEvents, formatEventValue, parseEventValue } from '@/lib/order-events';
import { callsOfOrder, collapseCalls } from '@/lib/calls-of-order';

export interface Interaction {
    type: 'call' | 'comment' | 'field_change';
    timestamp: string;
    content: string;
    metadata?: any;
}

export interface StageEvidence {
    orderId: number;
    status: string;
    entryTime: string;
    exitTime: string;
    interactions: Interaction[];
    customerOrdersCount?: number;
    metrics?: {
        contact_date_shifts: number;
        days_since_last_interaction: number;
        is_corporate: boolean;
        has_email: boolean;
        was_shipped_hint: boolean;
    };
}

/**
 * Service to collect all evidence for an order during its time in a specific status.
 */
export async function collectStageEvidence(orderId: number, status: string, entryTime: string, exitTime?: string): Promise<StageEvidence> {
    const end = exitTime || new Date().toISOString();

    // 0. Fetch Order Meta
    const { data: order } = await supabase
        .from('orders')
        .select('raw_payload, totalsumm')
        .eq('order_id', orderId)
        .single();

    const raw = (order?.raw_payload as any) || {};
    const customerOrdersCount = raw?.contact?.ordersCount || raw?.customer?.ordersCount;
    const is_corporate = raw?.customer?.type === 'customer_corporate' || !!raw?.company;
    const has_email = !!(raw?.email || raw?.contact?.email || raw?.customer?.email);

    // 1. Звонки по заказу.
    //
    // Привязку знает сама RetailCRM; наш матчинг по телефону оставлен костылём
    // и подставляется, только когда в выгрузке CRM по заказу пусто. Он
    // ошибается примерно в трети случаев, а по этим данным ставится оценка
    // качества, от которой зависит зарплата менеджера.
    const orderCalls = collapseCalls(await callsOfOrder(orderId, { from: entryTime, to: end }));

    // Расшифровка и текст разговора живут в Телфине, по идентификатору звонка.
    const telphinIds = orderCalls.map((c) => c.telphinCallId).filter(Boolean) as string[];
    const transcriptById = new Map<string, any>();
    if (telphinIds.length > 0) {
        const { data: rawCalls } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, started_at, transcript, event_id, duration_sec, transcription_status')
            .in('telphin_call_id', telphinIds);
        for (const c of ((rawCalls ?? []) as any[])) transcriptById.set(String(c.telphin_call_id), c);
    }

    const calls = orderCalls.map((c) => {
        const raw = c.telphinCallId ? transcriptById.get(c.telphinCallId) : null;
        return {
            started_at: c.startedAt,
            transcript: raw?.transcript ?? null,
            event_id: raw?.event_id ?? null,
            duration: c.durationSec,
            status: raw?.transcription_status ?? null,
            direction: c.direction,
            source: c.source,
        };
    });

    // 2. История изменений заказа — канонический источник order_history_log
    //    (см. lib/order-events.ts: raw_order_events заморожена с апреля 2026).
    const events = await fetchOrderEvents(orderId);

    const interactions: Interaction[] = [];
    let contact_date_shifts = 0;
    let was_shipped_hint = false;

    for (const e of events) {
        const time = e.occurredAt;
        const type = e.field;

        if (type === 'custom_data_kontakta') {
            contact_date_shifts++;
        }

        // Evidence collection (within requested status timeframe)
        if (time >= entryTime && time <= end) {
            if (type.includes('comment') || type.includes('message') || type.includes('email')) {
                const text = formatEventValue(e.newValue);
                if (text) {
                    const val = text.toLowerCase();
                    if (val.includes('отгружен') || val.includes('упд') || val.includes('отгруз')) {
                        was_shipped_hint = true;
                    }
                    interactions.push({
                        type: 'comment',
                        timestamp: time,
                        content: text
                    });
                }
            } else if (type.includes('status')) {
                interactions.push({
                    type: 'field_change',
                    timestamp: time,
                    content: `Статус изменен: ${formatEventValue(e.oldValue)} -> ${formatEventValue(e.newValue)}`,
                    metadata: { oldValue: parseEventValue(e.oldValue), newValue: parseEventValue(e.newValue) }
                });
            }
        }
    }

    // Add calls
    if (calls) {
        calls.forEach((call: any) => {
            interactions.push({
                type: 'call',
                timestamp: call.started_at,
                content: call.transcript || `Звонок (Длительность: ${call.duration} сек., Статус: ${call.status})`,
                metadata: {
                    call_id: call.event_id,
                    duration: call.duration,
                    status: call.status
                }
            });
        });
    }

    // Sort all by time
    interactions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const lastInteraction = interactions.length > 0 ? interactions[interactions.length - 1].timestamp : entryTime;
    const days_since_last_interaction = Math.floor((new Date().getTime() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60 * 24));

    return {
        orderId,
        status,
        entryTime,
        exitTime: end,
        interactions,
        customerOrdersCount,
        metrics: {
            contact_date_shifts,
            days_since_last_interaction,
            is_corporate,
            has_email,
            was_shipped_hint
        }
    };
}
