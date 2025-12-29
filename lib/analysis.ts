import { supabase } from '@/utils/supabase';

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
        calls.forEach(call => {
            violations.push({
                managerId: call.manager_id || 'UNKNOWN',
                type: 'MISSED_CALL',
                details: `Missed call from ${call.client_number}`,
                timestamp: call.timestamp
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
        stuckOrders.forEach(order => {
            violations.push({
                managerId: order.managerId || 'UNKNOWN',
                type: 'LATE_ORDER_PROCESSING',
                details: `Order ${order.number} has not been updated in 24h`,
                timestamp: new Date().toISOString()
            });
        });
    }

    return violations;
}
