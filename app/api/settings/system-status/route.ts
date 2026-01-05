
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
                'telphin_backfill_cursor',
                'transcription_min_duration'
            ]);

        if (syncError) throw syncError;

        const stateMap = new Map();
        syncStates?.forEach(s => stateMap.set(s.key, s));

        // 2. Fetch Latest Order time
        const { data: lastOrder } = await supabase
            .from('orders')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        // 3. Fetch recent Matching Stats
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: matches24h, error: matchError } = await supabase
            .from('call_order_matches')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', yesterday);

        // 4. Analysis & Diagnostics

        const isFresh = (dateStr: string | null, minutes: number) => {
            if (!dateStr) return false;
            const diff = Date.now() - new Date(dateStr).getTime();
            return diff < minutes * 60 * 1000;
        };

        const getDiagnosis = (service: string, isOk: boolean, lastRun: string | null) => {
            if (isOk) return null;
            if (!lastRun) return 'Никогда не запускался. Проверьте Cron.';

            if (service === 'telphin_main') {
                return 'Cron не запускался > 15 мин. Либо нет новых звонков, либо сбой Vercel Cron.';
            }
            if (service === 'telphin_backfill') {
                return 'Пауза из-за лимитов API (429) или процесс завершен.';
            }
            if (service === 'retailcrm') {
                return 'Нет новых заказов > 1 ч. Возможно, просто выходной день или ночь.';
            }
            return 'Требует проверки';
        };

        // --- Telphin Main ---
        const telphinMain = stateMap.get('telphin_last_sync_time');
        const telphinOk = isFresh(telphinMain?.updated_at, 15);
        const telphinStatus = {
            service: 'Telphin Main Sync',
            cursor: telphinMain?.value || 'Never',
            last_run: telphinMain?.updated_at || null,
            status: telphinOk ? 'ok' : 'warning',
            details: telphinOk ? 'Active' : 'Stalled (>15m ago)',
            reason: getDiagnosis('telphin_main', telphinOk, telphinMain?.updated_at)
        };

        // --- Telphin Backfill ---
        const telphinBackfill = stateMap.get('telphin_backfill_cursor');
        const backfillOk = isFresh(telphinBackfill?.updated_at, 5); // Strict 5m check
        const backfillStatus = {
            service: 'Telphin Backfill',
            cursor: telphinBackfill?.value || 'Never',
            last_run: telphinBackfill?.updated_at || null,
            status: backfillOk ? 'ok' : 'warning',
            details: backfillOk ? 'Running' : 'Stopped/Paused',
            reason: getDiagnosis('telphin_backfill', backfillOk, telphinBackfill?.updated_at)
        };

        // --- RetailCRM ---
        const retailCursor = lastOrder?.created_at || null;
        const retailOk = isFresh(retailCursor, 60);
        const retailStatus = {
            service: 'RetailCRM Sync',
            cursor: retailCursor || 'Never',
            last_run: retailCursor || null,
            status: retailOk ? 'ok' : 'warning',
            details: retailOk ? 'Recent Orders' : 'No recent orders (>1h)',
            reason: getDiagnosis('retailcrm', retailOk, retailCursor)
        };

        // --- Matching ---
        const matchOk = (matches24h || 0) > 0;
        const matchStatus = {
            service: 'Matching Service',
            cursor: 'Realtime',
            last_run: new Date().toISOString(),
            status: matchOk ? 'ok' : 'warning',
            details: `${matches24h || 0} matches in last 24h`,
            reason: matchOk ? null : 'Нет матчей за 24 часа. Либо нет звонков, либо сбой алгоритма.'
        };

        // --- Settings ---
        // Get generic keys or specific ones
        const settings = {
            transcription_min_duration: parseInt(stateMap.get('transcription_min_duration')?.value || '15')
        };

        return NextResponse.json({
            services: [telphinMain, telphinBackfill, retailStatus, matchStatus],
            dashboard: [telphinStatus, backfillStatus, retailStatus, matchStatus],
            settings
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { key, value } = body;

        if (!key || value === undefined) {
            return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
        }

        // Whitelist keys for safety if needed, but for now open for sync_state
        // Update sync_state
        const { error } = await supabase
            .from('sync_state')
            .upsert({
                key,
                value: String(value),
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        if (error) throw error;

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
