
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // 1. Fetch Sync Cursors
        const { data: syncStates, error: syncError } = await supabase
            .from('sync_state')
            .select('key, value, updated_at')
            .in('key', [
                'telphin_last_sync_time',
                'telphin_backfill_cursor'
            ]);

        if (syncError) throw syncError;

        const stateMap = new Map();
        syncStates?.forEach(s => stateMap.set(s.key, s));

        // 2. Fetch Latest Order time (since RetailCRM sync uses this instead of sync_state)
        const { data: lastOrder } = await supabase
            .from('orders')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        // 3. Fetch recent Matching Stats
        // Count matches in last 24h
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: matches24h, error: matchError } = await supabase
            .from('call_order_matches')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', yesterday);

        // 4. Construct Status Object

        // Helper to determine health (green/red) based on "updated_at" freshness
        const isFresh = (dateStr: string | null, minutes: number) => {
            if (!dateStr) return false;
            const diff = Date.now() - new Date(dateStr).getTime();
            return diff < minutes * 60 * 1000;
        };

        // Telphin Main
        const telphinMain = stateMap.get('telphin_last_sync_time');
        const telphinStatus = {
            service: 'Telphin Main Sync',
            cursor: telphinMain?.value || 'Never',
            last_run: telphinMain?.updated_at || null,
            status: isFresh(telphinMain?.updated_at, 15) ? 'ok' : 'warning', // Should run every ~10 mins
            details: isFresh(telphinMain?.updated_at, 15) ? 'Active' : 'Stalled (>15m ago)'
        };

        // Telphin Backfill
        const telphinBackfill = stateMap.get('telphin_backfill_cursor');
        const backfillStatus = {
            service: 'Telphin Backfill',
            cursor: telphinBackfill?.value || 'Never',
            last_run: telphinBackfill?.updated_at || null,
            // Backfill might finish, so "stalled" isn't always bad, but for now we assume it runs
            status: isFresh(telphinBackfill?.updated_at, 5) ? 'ok' : 'warning',
            details: isFresh(telphinBackfill?.updated_at, 5) ? 'Running' : 'Stopped/Paused'
        };

        // RetailCRM
        // Use lastOrder.created_at as the cursor
        const retailCursor = lastOrder?.created_at || null;
        const retailStatus = {
            service: 'RetailCRM Sync',
            cursor: retailCursor || 'Never',
            last_run: retailCursor || null, // Best proxy we have
            status: isFresh(retailCursor, 60) ? 'ok' : 'warning', // Orders might not happen every 15 mins, so 60 is safer
            details: isFresh(retailCursor, 60) ? 'Recent Orders' : 'No recent orders (>1h)'
        };

        // Matching
        const matchStatus = {
            service: 'Matching Service',
            cursor: 'Realtime',
            last_run: new Date().toISOString(), // It's on-demand or continuous
            status: 'ok', // Assumed OK if API responds
            details: `${matches24h || 0} matches in last 24h`
        };

        return NextResponse.json({
            services: [telphinMain, telphinBackfill, retailStatus, matchStatus], // debug raw
            dashboard: [telphinStatus, backfillStatus, retailStatus, matchStatus]
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
