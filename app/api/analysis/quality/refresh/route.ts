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

        // 2. Fetch Matches for last 35 days (Monthly stats need 30 days + buffer)
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 35);
        const startStr = startDate.toISOString();

        // Warning: filtering by matched_at is good, but ideally we filter by call date. 
        // We'll fetch matches created recently, which should cover recent calls.
        // Batched fetch via Join for efficiency with pagination
        let allMatches: any[] = [];
        let from = 0;
        const batchSize = 1000;
        let fetching = true;

        while (fetching) {
            const { data: batch, error: matchError } = await supabase
                .from('call_order_matches')
                .select(`
                    telphin_call_id,
                    retailcrm_order_id,
                    raw_telphin_calls (duration_sec, started_at),
                    orders (manager_id)
                `)
                .gte('matched_at', startStr)
                .range(from, from + batchSize - 1);

            if (matchError) throw matchError;

            if (batch && batch.length > 0) {
                allMatches = allMatches.concat(batch);
                from += batchSize;
                if (batch.length < batchSize) fetching = false;
            } else {
                fetching = false;
            }
        }

        const matches = allMatches;

        if (!matches || matches.length === 0) {
            console.log('[QualityRefresh] No matches found in window.');
            return NextResponse.json({ message: 'No matches found.' });
        }

        console.log(`[QualityRefresh] Processing ${matches.length} matches...`);

        // 5. Aggregate
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h rolling window
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
            const order = m.orders as any;
            const call = m.raw_telphin_calls as any;

            if (!order || !call) return;

            const managerId = order.manager_id ? String(order.manager_id) : null;

            // Verify manager is tracked and call exists
            if (managerId && statsMap[managerId]) {
                processedCount++;
                const duration = call.duration_sec || 0;
                const date = new Date(call.started_at);

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
