import { supabase } from '@/utils/supabase';

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

    // 1. Fetch Calls
    const { data: callMatches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, raw_telphin_calls(started_at, transcript, event_id)')
        .eq('retailcrm_order_id', orderId);

    const calls = (callMatches || [])
        .map((m: any) => m.raw_telphin_calls as any)
        .filter((c: any) => c && c.started_at >= entryTime && c.started_at <= end);

    // 2. Fetch History (from raw_order_events for richer context)
    const { data: rawEvents } = await supabase
        .from('raw_order_events')
        .select('*')
        .eq('retailcrm_order_id', orderId)
        .order('occurred_at', { ascending: true });

    const interactions: Interaction[] = [];
    let contact_date_shifts = 0;
    let was_shipped_hint = false;

    if (rawEvents) {
        rawEvents.forEach((e: any) => {
            const time = e.occurred_at;
            const type = e.event_type;
            const payload = e.raw_payload || {};

            // Count date shifts (if possible from payload)
            if (type === 'custom_data_kontakta' || (type.includes('change') && payload.field === 'custom_data_kontakta')) {
                contact_date_shifts++;
            }

            // Evidence collection (within requested status timeframe)
            if (time >= entryTime && time <= end) {
                if (type.includes('comment') || type.includes('message') || type.includes('email')) {
                    const text = payload.text || payload.newValue || payload.value;
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
                        content: `Статус изменен: ${payload.oldValue} -> ${payload.newValue}`,
                        metadata: payload
                    });
                }
            }
        });
    }

    // Add calls
    if (calls) {
        calls.forEach((call: any) => {
            if (call.transcript) {
                interactions.push({
                    type: 'call',
                    timestamp: call.started_at,
                    content: call.transcript,
                    metadata: { call_id: call.event_id }
                });
            }
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
