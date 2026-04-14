// ОТВЕТСТВЕННЫЙ: АННА (Бизнес-аналитик) — Глубокий анализ истории и трендов сделки.
import { supabase } from '@/utils/supabase';

type CallRow = {
    manager_id?: string | null;
    client_number?: string | null;
    timestamp?: string | null;
};

type OrderRow = {
    managerid?: string | null;
    number?: string | number | null;
};

export interface Violation {
    managerId: string;
    type: 'MISSED_CALL' | 'LATE_ORDER_PROCESSING' | 'BAD_STATUS';
    details: string;
    timestamp: string;
}

export async function analyzeViolations(): Promise<Violation[]> {
    const violations: Violation[] = [];

    // 1. Check for missed calls
    const { data: calls } = await supabase
        .from('calls')
        .select('*')
        .eq('status', 'missed') // Assuming 'status' field
        .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // Last 24h

    if (calls) {
        (calls as CallRow[]).forEach((call) => {
            violations.push({
                managerId: call.manager_id || 'UNKNOWN',
                type: 'MISSED_CALL',
                details: `Missed call from ${call.client_number || 'UNKNOWN'}`,
                timestamp: call.timestamp || new Date().toISOString()
            });
        });
    }

    // 2. Check for stale orders (not updated in > 24h)
    // This is hypothetical logic
    const { data: stuckOrders } = await supabase
        .from('orders')
        .select('*')
        .lt('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .neq('status', 'complete');

    if (stuckOrders) {
        (stuckOrders as OrderRow[]).forEach((order) => {
            violations.push({
                managerId: order.managerid || 'UNKNOWN', // postgres: managerid
                type: 'LATE_ORDER_PROCESSING',
                details: `Order ${order.number || 'UNKNOWN'} has not been updated in 24h`,
                timestamp: new Date().toISOString()
            });
        });
    }

    return violations;
}
