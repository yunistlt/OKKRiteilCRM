import { supabase } from '@/utils/supabase';

export interface EfficiencyReport {
    manager_id: number;
    manager_name: string;
    total_minutes: number;
    processed_orders: number; // Count of unique orders touched
}

export async function calculateEfficiency(startDate: string, endDate: string) {
    console.log(`[Efficiency] Calculating from ${startDate} to ${endDate}`);

    // 1. Get Working Statuses (The Whitelist)
    const { data: workingSettings } = await supabase
        .from('status_settings')
        .select('code')
        .eq('is_working', true);

    const workingCodes = new Set((workingSettings || []).map(s => s.code));
    console.log(`[Efficiency] Found ${workingCodes.size} working statuses`);

    // 1b. Fetch Controlled Managers
    const { data: controlledRaw } = await supabase.from('manager_settings').select('id').eq('is_controlled', true);
    const controlledIds = new Set((controlledRaw || []).map(m => m.id as number));
    const isControlActive = controlledIds.size > 0;

    // 2. Get History Events (Only Status Changes)
    const { data: events, error } = await supabase
        .from('order_history')
        .select('*')
        .eq('field_name', 'status')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('order_id', { ascending: true })
        .order('created_at', { ascending: true }); // Crucial for timeline reconstruction

    if (error) throw new Error(error.message);
    if (!events || events.length === 0) return [];

    console.log(`[Efficiency] Processing ${events.length} status events`);

    // 3. Group by Order to reconstruct timeline
    const orders: Record<number, any[]> = {};
    events.forEach(e => {
        if (!orders[e.order_id]) orders[e.order_id] = [];
        orders[e.order_id].push(e);
    });

    // 4. Calculate Time per Manager
    const managerTime: Record<number, number> = {};
    const managerOrders: Record<number, Set<number>> = {};

    Object.values(orders).forEach(orderEvents => {
        // Iterate through timeline
        for (let i = 0; i < orderEvents.length - 1; i++) {
            const current = orderEvents[i];
            const next = orderEvents[i + 1];

            const status = current.new_value; // The status SET at this moment
            const managerId = current.manager_id; // Who set it

            // Logic: If I put order in "Working Status", the timer runs until the NEXT status change.
            if (workingCodes.has(status) && managerId) {
                // Filter by Controlled Managers
                if (isControlActive && !controlledIds.has(managerId)) continue;

                const start = new Date(current.created_at).getTime();
                const end = new Date(next.created_at).getTime();
                const diffMinutes = (end - start) / 1000 / 60;

                if (diffMinutes > 0) {
                    if (!managerTime[managerId]) managerTime[managerId] = 0;
                    managerTime[managerId] += diffMinutes;

                    if (!managerOrders[managerId]) managerOrders[managerId] = new Set();
                    managerOrders[managerId].add(current.order_id);
                }
            }
        }
    });

    // 5. Refine Processed Orders (Exclude those with only AM calls if possible)
    // To do this strictly, we need to know which orders had at least one "REAL" (non-AM) call
    const { data: realCalls } = await supabase
        .from('calls')
        .select('id, matches(order_id)')
        .eq('is_answering_machine', false)
        .gte('timestamp', startDate)
        .lte('timestamp', endDate);

    const ordersWithRealContact = new Set((realCalls || []).flatMap(c => c.matches?.map((m: any) => m.order_id) || []));

    // 6. Fetch Manager Metadata
    const knownManagerIds = Object.keys(managerTime).map(Number);
    let managerNames: Record<number, string> = {};

    if (knownManagerIds.length > 0) {
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', knownManagerIds);

        if (managers) {
            managers.forEach(m => {
                managerNames[m.id] = `${m.first_name || ''} ${m.last_name || ''}`.trim() || `Manager #${m.id}`;
            });
        }
    }

    // 7. Format Output
    const report: EfficiencyReport[] = Object.keys(managerTime).map(mId => {
        const id = Number(mId);
        const allOrders = managerOrders[id] || new Set();
        // Intersection: Only count orders where manager had at least one REAL call
        const realProcessedCount = Array.from(allOrders).filter(oId => ordersWithRealContact.has(oId)).length;

        return {
            manager_id: id,
            manager_name: managerNames[id] || `Manager #${id}`,
            total_minutes: Math.round(managerTime[id]),
            processed_orders: realProcessedCount
        };
    });

    return report.sort((a, b) => b.total_minutes - a.total_minutes);
}
