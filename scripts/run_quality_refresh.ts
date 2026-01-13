
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { supabase } from '@/utils/supabase';

async function runQualityRefresh() {
    console.log('[QualityRefresh-Script] Starting aggregation update...');

    // 1. Fetch Controlled Managers
    const { data: controlledManagers } = await supabase
        .from('manager_settings')
        .select('id')
        .eq('is_controlled', true);

    const controlledIds = (controlledManagers || []).map(m => m.id.toString());
    console.log('[QualityRefresh-Script] Controlled IDs:', controlledIds);

    if (controlledIds.length === 0) {
        console.log('No controlled managers.');
        return;
    }

    // 2. Fetch Matches for last 35 days (covering full month stats + buffer)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 35);
    const startStr = startDate.toISOString();

    const { data: matches, error: matchError } = await supabase
        .from('call_order_matches')
        .select(`
            telphin_call_id,
            retailcrm_order_id,
            raw_telphin_calls (duration_sec, started_at),
            orders (manager_id)
        `)
        .gte('matched_at', startStr);

    if (matchError) throw matchError;
    if (!matches || matches.length === 0) {
        console.log('[QualityRefresh-Script] No matches found in window.');
        return;
    }

    console.log(`[QualityRefresh-Script] Processing ${matches.length} matches...`);

    // 5. Aggregate
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
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
        // Safe access to nested properties
        const order = m.orders as any;
        const call = m.raw_telphin_calls as any;

        if (!order || !call) return;

        const managerId = order.manager_id ? String(order.manager_id) : null;

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

    console.log(`[QualityRefresh-Script] Aggregated ${processedCount} calls.`);

    // 6. Upsert
    const rows = Object.values(statsMap);
    const { error: upsertError } = await supabase
        .from('dialogue_stats')
        .upsert(rows, { onConflict: 'manager_id' });

    if (upsertError) {
        console.error('Upsert Error:', upsertError);
    } else {
        console.log(`[QualityRefresh-Script] Successfully updated stats for ${rows.length} managers.`);
    }
}

runQualityRefresh();
