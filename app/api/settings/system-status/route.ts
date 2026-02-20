
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
                'telphin_last_sync_time',
                'telphin_backfill_cursor',
                'transcription_min_duration',
                'rule_engine_last_run',
                'insight_agent_last_run'
            ]);

        if (syncError) throw syncError;

        const stateMap = new Map();
        syncStates?.forEach(s => stateMap.set(s.key, s));

        // 2. Fetch Latest Order time
        const { data: lastOrder } = await supabase
            .from('orders')
            .select('created_at')
            .order('created_at', { ascending: false })
            .not('created_at', 'is', null)
            .limit(1)
            .single();

        // 3. Fetch recent Matching Stats
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: matches24h, error: matchError } = await supabase
            .from('call_order_matches')
            .select('*', { count: 'exact', head: true })
            .gte('matched_at', yesterday);

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

        // --- Transcription Backfill ---
        const transCursorKey = stateMap.get('transcription_backfill_cursor');
        const transCursor = transCursorKey?.value || 'Starts Sept 1';
        const transLastRun = transCursorKey?.updated_at || null;
        // Logic: If updated recently (< 10m), it's active. (Cron schedule is 2m, so 10m is safe buffer)
        const transActive = isFresh(transLastRun, 10);

        const transStatus = {
            service: 'Transcription Backfill',
            cursor: transCursor.includes('T') ? transCursor.split('T')[0] : transCursor,
            last_run: transLastRun,
            status: transActive ? 'ok' : 'warning',
            details: transActive ? 'Processing...' : 'Idle / Finished',
            reason: transActive ? null : 'Скрипт ожидает запуска cron или завершил работу.'
        };

        // --- Matching Backfill ---
        const matchBackCursorKey = stateMap.get('matching_backfill_cursor');
        const matchBackCursor = matchBackCursorKey?.value || 'Starts Sept 1';
        const matchBackLastRun = matchBackCursorKey?.updated_at || null;
        const matchBackActive = isFresh(matchBackLastRun, 10);

        const matchBackStatus = {
            service: 'Matching Backfill',
            // Show only YYYY-MM-DD
            cursor: matchBackCursor.includes('T') ? matchBackCursor.split('T')[0] : matchBackCursor,
            last_run: matchBackLastRun,
            status: matchBackActive ? 'ok' : 'warning',
            details: matchBackActive ? 'Matching...' : 'Idle / Finished',
            reason: matchBackActive ? null : 'Скрипт ожидает запуска или завершил работу.'
        };

        // 4.5. Fetch Latest History Event (Rule Engine Source)
        const { data: lastHistoryEvent } = await supabase
            .from('raw_order_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single();

        const historyCursor = lastHistoryEvent?.occurred_at || null;
        const historyOk = isFresh(historyCursor, 120); // 2 hours threshold
        const historyStatus = {
            service: 'History Sync (Rules)',
            cursor: historyCursor || 'Never',
            last_run: historyCursor || null,
            status: historyOk ? 'ok' : 'warning',
            details: historyOk ? 'Events Flowing' : 'Stalled (>2h)',
            reason: getDiagnosis('history_sync', historyOk, historyCursor)
        };

        // 4.6 Rule Engine Execution & Active Rules
        const ruleRunKey = stateMap.get('rule_engine_last_run');
        const lastRuleRun = ruleRunKey?.updated_at || null;
        const ruleRunOk = isFresh(lastRuleRun, 65); // 1 hour + 5 min buffer

        // --- Rule Engine Health ---
        const { data: allRules } = await supabase
            .from('okk_rules')
            .select('name, is_active')
            .order('name');

        const activeRules = allRules?.filter(r => r.is_active).map(r => r.name) || [];
        const inactiveRules = allRules?.filter(r => !r.is_active).map(r => r.name) || [];

        const rulesStatus = {
            service: 'Rule Engine Execution',
            cursor: 'Automated',
            last_run: lastRuleRun,
            status: ruleRunOk ? 'ok' : 'error',
            details: activeRules.length > 0
                ? `Active (${activeRules.length}): ${activeRules.join(', ')}`
                : 'No active rules found!',
            reason: !ruleRunOk ? 'System has not run for > 1 hour. Possible Cron/API failure.' : null,
            active_rules: activeRules,
            inactive_rules: inactiveRules
        };

        // 4.7 Insight Agent Health
        const insightRunKey = stateMap.get('insight_agent_last_run');
        const lastInsightRun = insightRunKey?.updated_at || null;
        const insightRunOk = isFresh(lastInsightRun, 120); // 2 hours threshold

        const insightStatus = {
            service: 'AI Insight Agent',
            cursor: 'Deep Analysis',
            last_run: lastInsightRun,
            status: insightRunOk ? 'ok' : 'warning',
            details: insightRunOk ? 'Extracting Business Facts' : 'Idle or Stalled',
            reason: !insightRunOk ? 'Аналитик не запускался более 2 часов.' : null
        };

        // 4.8 Fetch Recent Insights for Monitor feed
        const { data: recentInsights } = await supabase
            .from('order_metrics')
            .select('retailcrm_order_id, insights, computed_at, orders(number)')
            .not('insights', 'is', null)
            .order('computed_at', { ascending: false })
            .limit(5);

        const logs = (recentInsights || []).map((ri: any) => ({
            order_number: ri.orders?.number,
            summary: ri.insights?.summary || 'Успешный анализ',
            time: ri.computed_at
        }));

        // --- Settings ---
        // Get generic keys or specific ones
        const settings = {
            transcription_min_duration: parseInt(stateMap.get('transcription_min_duration')?.value || '15')
        };

        return NextResponse.json({
            services: [telphinStatus, retailStatus, matchStatus, historyStatus, rulesStatus, insightStatus],
            dashboard: [telphinStatus, retailStatus, matchStatus, historyStatus, rulesStatus, insightStatus],
            all_rules: allRules || [],
            settings,
            insight_logs: logs
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
