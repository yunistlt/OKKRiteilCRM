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
}

/**
 * Service to collect all evidence for an order during its time in a specific status.
 */
export async function collectStageEvidence(orderId: number, status: string, entryTime: string, exitTime?: string): Promise<StageEvidence> {
    const end = exitTime || new Date().toISOString();

    // 1. Fetch Calls
    const { data: callMatches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, raw_telphin_calls(started_at, transcript, event_id)')
        .eq('retailcrm_order_id', orderId);

    const calls = (callMatches || [])
        .map(m => m.raw_telphin_calls as any)
        .filter(c => c && c.started_at >= entryTime && c.started_at <= end);

    // Note: Telphin calls might need a join or separate query if matching is complex
    // For now, assuming raw_telphin_calls has some link or we use the match table

    // 2. Fetch History (Comments and field changes)
    const { data: history } = await supabase
        .from('order_history_log')
        .select('occurred_at, field, old_value, new_value')
        .eq('retailcrm_order_id', orderId)
        .gte('occurred_at', entryTime)
        .lte('occurred_at', end)
        .order('occurred_at', { ascending: true });

    const interactions: Interaction[] = [];

    // Add calls
    if (calls) {
        calls.forEach(call => {
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

    // Add comments
    if (history) {
        history.forEach(h => {
            if (h.field === 'manager_comment' && h.new_value) {
                interactions.push({
                    type: 'comment',
                    timestamp: h.occurred_at,
                    content: h.new_value
                });
            } else if (h.field.startsWith('custom_')) {
                // Relevant custom field change (e.g. LPR, spheres of influence)
                interactions.push({
                    type: 'field_change',
                    timestamp: h.occurred_at,
                    content: `Поле ${h.field} изменено на: ${h.new_value}`,
                    metadata: { field: h.field, value: h.new_value }
                });
            }
        });
    }

    // Sort all by time
    interactions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return {
        orderId,
        status,
        entryTime,
        exitTime: end,
        interactions
    };
}
