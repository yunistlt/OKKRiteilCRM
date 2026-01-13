import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function POST() {
    try {
        console.log('[QualityRefresh] Starting aggregation update (In-Memory V2)...');

        // 1. Fetch Controlled Managers
        const { data: controlledManagers } = await supabase
            .from('manager_settings')
            .select(`
                id,
                managers!inner (
                    first_name,
                    last_name
                )
            `)
            .eq('is_controlled', true);

        const controlledIds = (controlledManagers || []).map(m => m.id.toString());
        console.log('[QualityRefresh] Controlled IDs:', controlledIds);

        if (controlledIds.length === 0) {
            return NextResponse.json({ message: 'No controlled managers to update.' });
        }

        // 2. Fetch Matches for last 30 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 2);
        const startStr = startDate.toISOString();

        // Warning: filtering by matched_at is good, but ideally we filter by call date. 
        // We'll fetch matches created recently, which should cover recent calls.
        const { data: matches, error: matchError } = await supabase
            .from('call_order_matches')
            .select('telphin_call_id, retailcrm_order_id')
            .gte('matched_at', startStr);

        if (matchError) throw matchError;
        if (!matches || matches.length === 0) {
            console.log('[QualityRefresh] No matches found in window.');
            return NextResponse.json({ message: 'No matches found.' });
        }

        const orderIds = matches.map(m => m.retailcrm_order_id);
        const callIds = matches.map(m => m.telphin_call_id);

        console.log(`[QualityRefresh] Processing ${matches.length} matches...`);

        // 3. Fetch Orders (to get manager_id)
        // Batched fetch if necessary, but for valid range < 10000 ok
        const { data: orders, error: orderError } = await supabase
            .from('orders')
            .select('id, manager_id')
            .in('id', orderIds);

        if (orderError) throw orderError;

        // Map order_id -> manager_id
        const orderManagerMap = new Map<number, string>();
        orders?.forEach(o => {
            if (o.manager_id) orderManagerMap.set(o.id, String(o.manager_id));
        });

        // 4. Fetch Calls (to get duration and time)
        const { data: calls, error: callError } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, duration_sec, started_at')
            .in('telphin_call_id', callIds);

        if (callError) throw callError;

        // Map telphin_call_id -> call details
        const callDetailsMap = new Map<string, { duration: number, date: Date }>();
        calls?.forEach(c => {
            callDetailsMap.set(c.telphin_call_id, {
                duration: c.duration_sec || 0,
                date: new Date(c.started_at)
            });
        });

        // 5. Aggregate
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h rolling window
        // For "Today" usually means "Since midnight", but UI says "Today". Let's stick to 24h rolling or "Since Midnight"?
        // UI usually implies "Today" (calendar day). Let's use strict Calendar Day for D1 if possible, or 24h.
        // The dashboard D1/7/30 usually implies rolling windows in this system, as per existing logic.
        // Let's stick to strict 24h to be safe, or check user intent. 
        // Re-reading code: it used `callDate >= oneDayAgo`. That's 24h rolling.

        // BUT user asked "today 0". User likely expects "Midnight to Now".
        // Let's use "Since Midnight Local Time"? No, server is UTC. 
        // Let's use 24h rolling to be consistent with previous logic.

        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const statsMap: Record<string, any> = {};
        for (const id of controlledIds) {
            statsMap[id] = {
                manager_id: id,
                d1_count: 0, d1_duration: 0,
                d7_count: 0, d7_duration: 0,
                d30_count: 0, d30_duration: 0,
                updated_at: now.toISOString()
            };
        }

        let processedCount = 0;

        matches.forEach(m => {
            const managerId = orderManagerMap.get(m.retailcrm_order_id);
            const call = callDetailsMap.get(m.telphin_call_id);

            // Verify manager is tracked and call exists
            if (managerId && statsMap[managerId] && call) {
                processedCount++;
                const { duration, date } = call;

                statsMap[managerId].d30_count++;
                statsMap[managerId].d30_duration += duration;

                if (date >= sevenDaysAgo) {
                    statsMap[managerId].d7_count++;
                    statsMap[managerId].d7_duration += duration;
                }

                if (date >= oneDayAgo) {
                    statsMap[managerId].d1_count++;
                    statsMap[managerId].d1_duration += duration;
                }
            }
        });

        console.log(`[QualityRefresh] Aggregated ${processedCount} calls into stats.`);

        // 6. Upsert
        const rows = Object.values(statsMap);
        const { data: upsertResult, error: upsertError } = await supabase
            .from('dialogue_stats')
            .upsert(rows, { onConflict: 'manager_id' })
            .select();

        if (upsertError) throw upsertError;

        return NextResponse.json({
            success: true,
            updatedManagers: rows.length,
            upsertedCount: upsertResult?.length,
            matchesFound: matches.length,
            callsLinked: processedCount,
            timestamp: now.toISOString()
        });

    } catch (e: any) {
        console.error('[QualityRefresh] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
