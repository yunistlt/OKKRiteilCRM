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

    // 2. Fetch History (Comments and field changes)
    const { data: history } = await supabase
        .from('order_history_log')
        .select('occurred_at, field, old_value, new_value')
        .eq('retailcrm_order_id', orderId)
        .order('occurred_at', { ascending: true });

    const interactions: Interaction[] = [];
    let contact_date_shifts = 0;
    let was_shipped_hint = false;

    if (history) {
        history.forEach((h: any) => {
            // Count date shifts
            if (h.field === 'custom_data_kontakta') {
                contact_date_shifts++;
            }

            // Evidence collection (within requested status timeframe)
            if (h.occurred_at >= entryTime && h.occurred_at <= end) {
                if (h.field === 'manager_comment' && h.new_value) {
                    const val = h.new_value.toLowerCase();
                    if (val.includes('отгружен') || val.includes('упд') || val.includes('отгруз')) {
                        was_shipped_hint = true;
                    }
                    interactions.push({
                        type: 'comment',
                        timestamp: h.occurred_at,
                        content: h.new_value
                    });
                } else if (h.field.startsWith('custom_')) {
                    interactions.push({
                        type: 'field_change',
                        timestamp: h.occurred_at,
                        content: `Поле ${h.field} изменено на: ${h.new_value}`,
                        metadata: { field: h.field, value: h.new_value }
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
