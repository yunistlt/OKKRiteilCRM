import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function POST() {
    try {
        console.log('[QualityRefresh] Starting aggregation update...');

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

        const managerInfo = Object.fromEntries(
            (controlledManagers || []).map(m => [m.id, `${(m as any).managers.first_name} ${(m as any).managers.last_name}`])
        );

        // 2. Fetch all relevant calls for the last 30 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        const { data: calls } = await supabase
            .from('calls')
            .select(`
                id,
                duration,
                timestamp,
                call_order_matches!inner (
                    orders!inner (
                        manager_id
                    )
                )
            `)
            .gte('timestamp', startDate.toISOString())
            .eq('is_answering_machine', false);

        console.log('[QualityRefresh] Live calls found:', calls?.length || 0);

        // 3. Aggregate data
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

        (calls || []).forEach(call => {
            const managerId = (call as any).call_order_matches[0]?.orders?.manager_id;
            if (!managerId || !statsMap[managerId]) return;

            const callDate = new Date(call.timestamp);
            const duration = call.duration || 0;

            statsMap[managerId].d30_count++;
            statsMap[managerId].d30_duration += duration;

            if (callDate >= sevenDaysAgo) {
                statsMap[managerId].d7_count++;
                statsMap[managerId].d7_duration += duration;
            }

            if (callDate >= oneDayAgo) {
                statsMap[managerId].d1_count++;
                statsMap[managerId].d1_duration += duration;
            }
        });

        // 4. Upsert into dialogue_stats
        const rows = Object.values(statsMap);
        console.log('[QualityRefresh] Upserting rows:', rows.length);

        const { data: upsertResult, error: upsertError } = await supabase
            .from('dialogue_stats')
            .upsert(rows, { onConflict: 'manager_id' })
            .select();

        if (upsertError) {
            console.error('[QualityRefresh] Upsert Error:', upsertError);
            throw upsertError;
        }

        console.log('[QualityRefresh] Upsert Success. Rows in result:', upsertResult?.length);

        return NextResponse.json({
            success: true,
            updatedManagers: rows.length,
            upsertedCount: upsertResult?.length,
            timestamp: now.toISOString(),
            debug_rows: rows
        });

    } catch (e: any) {
        console.error('[QualityRefresh] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
