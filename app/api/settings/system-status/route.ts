
// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { getRealtimePipelineMonitoringSnapshot } from '@/lib/system-jobs-monitoring';
import { getRealtimePipelineRuntimeState, normalizeRealtimePipelineOverride } from '@/lib/realtime-pipeline';
import { getTelphinLegacyCompatRuntimeState, normalizeTelphinLegacyCompatOverride } from '@/lib/telphin-legacy-compat';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

function formatLatency(seconds: number | null) {
    if (seconds === null) return 'n/a';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

function buildSlaStatus(params: {
    service: string;
    metric: { p50Seconds: number | null; p95Seconds: number | null; sampleSize: number };
    warningP95Seconds: number;
    errorP95Seconds: number;
    emptyReason: string;
}) {
    const { service, metric, warningP95Seconds, errorP95Seconds, emptyReason } = params;
    const p95 = metric?.p95Seconds ?? null;
    const p50 = metric?.p50Seconds ?? null;
    const samples = metric?.sampleSize ?? 0;

    let status = 'ok';
    let reason = null;

    if (samples === 0) {
        status = 'warning';
        reason = emptyReason;
    } else if (p95 !== null && p95 > errorP95Seconds) {
        status = 'error';
        reason = `p95 выше SLA: ${formatLatency(p95)} > ${formatLatency(errorP95Seconds)}`;
    } else if (p95 !== null && p95 > warningP95Seconds) {
        status = 'warning';
        reason = `p95 приближается к SLA: ${formatLatency(p95)}`;
    }

    return {
        service,
        cursor: 'Domain SLA',
        last_run: new Date().toISOString(),
        status,
        details: `p50 ${formatLatency(p50)}, p95 ${formatLatency(p95)}, samples ${samples}`,
        reason,
    };
}

function getWorkerHealth(stateMap: Map<any, any>, workerKey: string) {
    const lastSuccess = stateMap.get(`${workerKey}.last_success_at`);
    const lastError = stateMap.get(`${workerKey}.last_error`);
    const lastErrorAt = stateMap.get(`${workerKey}.last_error_at`);
    const lastSuccessAt = lastSuccess?.value || lastSuccess?.updated_at || null;
    const lastErrorAtValue = lastErrorAt?.value || lastErrorAt?.updated_at || null;
    const hasActiveError = Boolean(
        lastError?.value && (!lastSuccessAt || (lastErrorAtValue && new Date(lastErrorAtValue).getTime() >= new Date(lastSuccessAt).getTime()))
    );

    return {
        lastSuccessAt,
        lastError: lastError?.value || '',
        lastErrorAt: lastErrorAtValue,
        hasActiveError,
    };
}

export async function GET() {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // 1. Fetch Sync Cursors
        const { data: syncStates, error: syncError } = await supabase
            .from('sync_state')
            .select('key, value, updated_at')
            .in('key', [
                'telphin_last_sync_time',
                'telphin_backfill_cursor',
                'telphin_backfill_last_error',
                'telphin_last_sync_time',
                'telphin_backfill_cursor',
                'telphin_fallback_lag_seconds',
                'telphin_fallback_last_error',
                'telphin_fallback_lock_status',
                'telphin_fallback_lock_holder',
                'telphin_backfill_lock_status',
                'telphin_backfill_lock_holder',
                'transcription_min_duration',
                'realtime_pipeline_override',
                'telphin_legacy_compat_override',
                'transcription_last_run',
                'rule_engine_last_run',
                'fallback.transcription.last_success_at',
                'fallback.transcription.last_error_at',
                'fallback.transcription.last_error',
                'fallback.matching.last_success_at',
                'fallback.matching.last_error_at',
                'fallback.matching.last_error',
                'fallback.retailcrm_sync.last_success_at',
                'fallback.retailcrm_sync.last_error_at',
                'fallback.retailcrm_sync.last_error',
                'fallback.history_sync.last_success_at',
                'fallback.history_sync.last_error_at',
                'fallback.history_sync.last_error',
                'fallback.insight_agent.last_success_at',
                'fallback.insight_agent.last_error_at',
                'fallback.insight_agent.last_error',
                'system_jobs.rule_engine.last_success_at',
                'system_jobs.rule_engine.last_error_at',
                'system_jobs.rule_engine.last_error',
                'insight_agent_last_run',
                'retailcrm_orders_sync',
                'retailcrm_history_sync',
                'retailcrm_orders_queue_last_success_at',
                'retailcrm_history_queue_last_success_at',
                'retailcrm_api_failure_count',
                'retailcrm_api_circuit_open_until',
                'retailcrm_api_last_error'
            ]);

        if (syncError) throw syncError;

        const stateMap = new Map();
        syncStates?.forEach(s => stateMap.set(s.key, s));
        const retailFallbackWorker = getWorkerHealth(stateMap, 'fallback.retailcrm_sync');
        const matchingFallbackWorker = getWorkerHealth(stateMap, 'fallback.matching');
        const transcriptionFallbackWorker = getWorkerHealth(stateMap, 'fallback.transcription');
        const historyFallbackWorker = getWorkerHealth(stateMap, 'fallback.history_sync');
        const insightFallbackWorker = getWorkerHealth(stateMap, 'fallback.insight_agent');

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
        const telphinFallbackLagSeconds = parseInt(stateMap.get('telphin_fallback_lag_seconds')?.value || '0', 10);
        const telphinFallbackLastError = stateMap.get('telphin_fallback_last_error')?.value || '';
        const telphinFallbackLockStatus = stateMap.get('telphin_fallback_lock_status')?.value || 'idle';
        const telphinOk = isFresh(telphinMain?.updated_at, 15);
        const telphinStatus = {
            service: 'Telphin Fallback Sync',
            cursor: 'Fallback only',
            last_run: telphinMain?.updated_at || null,
            status: telphinFallbackLastError ? 'warning' : 'ok',
            details: `Backup-only sync${telphinFallbackLagSeconds > 0 ? `, lag ${Math.floor(telphinFallbackLagSeconds / 60)} min` : ''}${telphinFallbackLockStatus === 'running' ? ', running' : telphinFallbackLockStatus === 'contended' ? ', busy' : ''}`,
            reason: telphinFallbackLastError || 'Primary Telphin ownership is handled by webhook-first ingest; this route is fallback-only.'
        };

        // --- Telphin Backfill ---
        const telphinBackfill = stateMap.get('telphin_backfill_cursor');
        const telphinBackfillLastError = stateMap.get('telphin_backfill_last_error')?.value || '';
        const telphinBackfillLockStatus = stateMap.get('telphin_backfill_lock_status')?.value || 'idle';
        const backfillOk = isFresh(telphinBackfill?.updated_at, 5); // Strict 5m check
        const backfillStatus = {
            service: 'Telphin Backfill Sweep',
            cursor: 'Fallback only',
            last_run: telphinBackfill?.updated_at || null,
            status: telphinBackfillLastError ? 'warning' : (telphinBackfillLockStatus === 'contended' ? 'warning' : 'ok'),
            details: telphinBackfillLockStatus === 'running'
                ? 'Backup sweep running (lock held)'
                : telphinBackfillLockStatus === 'contended'
                    ? 'Busy in another worker'
                    : (backfillOk ? 'Idle / recently completed' : 'Idle / waiting manual run'),
            reason: telphinBackfillLastError || (telphinBackfillLockStatus === 'contended'
                ? 'Другой fallback worker уже держит lease-lock и выполняет синхронизацию.'
                : 'Slow backlog-recovery sweep for missed Telphin webhook gaps.')
        };

        const realtimePipelineState = await getRealtimePipelineRuntimeState();
        const telphinLegacyCompatState = await getTelphinLegacyCompatRuntimeState();
        const realtimePipelineEnabled = realtimePipelineState.effectiveEnabled;

        // --- RetailCRM ---
        const retailCursorState = stateMap.get('retailcrm_orders_sync');
        const retailCursor = retailCursorState?.value || lastOrder?.created_at || null;
        const retailLastRun = retailFallbackWorker.lastSuccessAt || stateMap.get('retailcrm_orders_queue_last_success_at')?.updated_at || retailCursorState?.updated_at || retailCursor || null;
        const retailOk = isFresh(retailLastRun, 15);
        const retailLagMinutes = retailCursor ? Math.floor((Date.now() - new Date(retailCursor).getTime()) / 60000) : null;
        const retailCircuitOpenUntil = stateMap.get('retailcrm_api_circuit_open_until')?.value || '';
        const retailCircuitError = stateMap.get('retailcrm_api_last_error')?.value || '';
        const retailCircuitFailures = parseInt(stateMap.get('retailcrm_api_failure_count')?.value || '0', 10);
        const retailCircuitOpen = retailCircuitOpenUntil && new Date(retailCircuitOpenUntil).getTime() > Date.now();
        const retailStatus = {
            service: 'RetailCRM Fallback Sync',
            cursor: realtimePipelineEnabled ? 'Fallback only' : (retailCursor || 'Never'),
            last_run: retailLastRun,
            status: retailFallbackWorker.hasActiveError
                ? 'warning'
                : (retailCircuitOpen ? 'warning' : (realtimePipelineEnabled ? 'ok' : (retailOk ? 'ok' : 'warning'))),
            details: realtimePipelineEnabled
                ? `Backup-only manual force run${retailLagMinutes !== null ? `, cursor lag ${retailLagMinutes} min` : ''}${retailCircuitOpen ? ', circuit open' : retailCircuitFailures > 0 ? `, failures ${retailCircuitFailures}` : ''}`
                : (retailLagMinutes !== null ? `Cursor lag ${retailLagMinutes} min` : 'No cursor yet'),
            reason: retailFallbackWorker.hasActiveError
                ? retailFallbackWorker.lastError
                : retailCircuitOpen
                ? `Circuit breaker открыт до ${retailCircuitOpenUntil}. ${retailCircuitError || 'RetailCRM временно недоступен или отвечает 429/5xx.'}`
                : realtimePipelineEnabled
                ? 'Primary RetailCRM ownership is handled by retailcrm delta/history workers in realtime pipeline.'
                : getDiagnosis('retailcrm', retailOk, retailLastRun)
        };
    // --- Matching ---
        const matchOk = (matches24h || 0) > 0;
        const matchStatus = {
            service: 'Matching Fallback Sweep',
            cursor: 'Fallback only',
            last_run: matchingFallbackWorker.lastSuccessAt,
            status: matchingFallbackWorker.hasActiveError
                ? 'warning'
                : (realtimePipelineEnabled ? 'ok' : (matchOk ? 'ok' : 'warning')),
            details: realtimePipelineEnabled
                ? 'Backup-only manual force sweep'
                : `${matches24h || 0} matches in last 24h`,
            reason: matchingFallbackWorker.hasActiveError
                ? matchingFallbackWorker.lastError
                : realtimePipelineEnabled
                ? 'Primary matching ownership is handled by call_match queue in realtime pipeline.'
                : (matchOk ? null : 'Нет матчей за 24 часа. Либо нет звонков, либо сбой алгоритма.')
        };

        // --- Transcription (Semen) ---
        const transLastRunKey = stateMap.get('transcription_last_run');
        const transCursorKey = stateMap.get('transcription_backfill_cursor');

        const transLastRun = transcriptionFallbackWorker.lastSuccessAt || transLastRunKey?.updated_at || transCursorKey?.updated_at || null;
        const transActive = isFresh(transLastRun, 65); // 1 hour + buffer

        const transCursor = transCursorKey?.value || 'Active Sync';

        const transStatus = {
            service: 'Transcription Fallback Sweep',
            cursor: transCursor.includes('T') ? transCursor.split('T')[0] : transCursor,
            last_run: transLastRun,
            status: transcriptionFallbackWorker.hasActiveError
                ? 'warning'
                : (realtimePipelineEnabled ? 'ok' : (transActive ? 'ok' : 'warning')),
            details: realtimePipelineEnabled ? 'Backup-only manual force sweep' : (transActive ? 'Processing Calls' : 'Idle / Stalled'),
            reason: transcriptionFallbackWorker.hasActiveError
                ? transcriptionFallbackWorker.lastError
                : realtimePipelineEnabled
                ? 'Primary transcription ownership is handled by call_transcription queue in realtime pipeline.'
                : (transActive ? null : 'Скрипт ожидает запуска cron или завершил работу.')
        };

        // --- Matching Backfill ---
        const matchBackCursorKey = stateMap.get('matching_backfill_cursor');
        const matchBackCursor = matchBackCursorKey?.value || 'Starts Sept 1';
        const matchBackLastRun = matchBackCursorKey?.updated_at || null;
        const matchBackActive = isFresh(matchBackLastRun, 10);

        const matchBackStatus = {
            service: 'Matching Backfill Sweep',
            cursor: 'Fallback only',
            last_run: matchBackLastRun,
            status: 'ok',
            details: matchBackActive ? 'Fallback sweep running' : 'Idle / manual fallback only',
            reason: 'Legacy backfill sweep for missed matches outside primary call_match queue.'
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
        const historyLastRun = historyFallbackWorker.lastSuccessAt || historyCursor || null;
        const historyStatus = {
            service: 'History Fallback Sync',
            cursor: realtimePipelineEnabled ? 'Fallback only' : (historyCursor || 'Never'),
            last_run: historyLastRun,
            status: historyFallbackWorker.hasActiveError
                ? 'warning'
                : (realtimePipelineEnabled ? 'ok' : (historyOk ? 'ok' : 'warning')),
            details: realtimePipelineEnabled ? 'Backup-only manual force run' : (historyOk ? 'Events Flowing' : 'Stalled (>2h)'),
            reason: historyFallbackWorker.hasActiveError
                ? historyFallbackWorker.lastError
                : realtimePipelineEnabled
                ? 'Primary history ownership is handled by retailcrm_history_delta worker in realtime pipeline.'
                : getDiagnosis('history_sync', historyOk, historyCursor)
        };

        // 4.6 Rule Engine Execution & Active Rules
        const ruleRunKey = stateMap.get('rule_engine_last_run');
        const ruleWorkerSuccess = stateMap.get('system_jobs.rule_engine.last_success_at');
        const ruleWorkerError = stateMap.get('system_jobs.rule_engine.last_error');
        const ruleWorkerErrorAt = stateMap.get('system_jobs.rule_engine.last_error_at');
        const lastRuleRun = ruleWorkerSuccess?.value || ruleRunKey?.updated_at || null;
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
            status: (ruleWorkerError?.value && (!ruleWorkerSuccess?.value || (ruleWorkerErrorAt?.value && new Date(ruleWorkerErrorAt.value).getTime() >= new Date(ruleWorkerSuccess.value).getTime())))
                ? 'error'
                : (ruleRunOk ? 'ok' : 'error'),
            details: activeRules.length > 0
                ? `Active (${activeRules.length}): ${activeRules.join(', ')}`
                : 'No active rules found!',
            reason: (ruleWorkerError?.value && (!ruleWorkerSuccess?.value || (ruleWorkerErrorAt?.value && new Date(ruleWorkerErrorAt.value).getTime() >= new Date(ruleWorkerSuccess.value).getTime())))
                ? `Последняя ошибка worker: ${ruleWorkerError.value}`
                : (!ruleRunOk ? 'System has not run for > 1 hour. Possible Cron/API failure.' : null),
            active_rules: activeRules,
            inactive_rules: inactiveRules
        };

        // 4.7 Insight Agent Health
        const insightRunKey = stateMap.get('insight_agent_last_run');
        const lastInsightRun = insightFallbackWorker.lastSuccessAt || insightRunKey?.updated_at || null;
        const insightRunOk = isFresh(lastInsightRun, 120); // 2 hours threshold
        const insightRealtimeOwned = realtimePipelineState.effectiveEnabled;

        const insightStatus = {
            service: 'AI Insight Agent',
            cursor: insightRealtimeOwned ? 'Fallback only' : 'Deep Analysis',
            last_run: lastInsightRun,
            status: insightFallbackWorker.hasActiveError
                ? 'warning'
                : (insightRealtimeOwned ? 'ok' : (insightRunOk ? 'ok' : 'warning')),
            details: insightRealtimeOwned ? 'Backup-only targeted or force run' : (insightRunOk ? 'Extracting Business Facts' : 'Idle or Stalled'),
            reason: insightFallbackWorker.hasActiveError
                ? insightFallbackWorker.lastError
                : insightRealtimeOwned
                ? 'Primary insight ownership is handled by order_insight_refresh queue in realtime pipeline.'
                : (!insightRunOk ? 'Аналитик не запускался более 2 часов.' : null)
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
            transcription_min_duration: parseInt(stateMap.get('transcription_min_duration')?.value || '15'),
            realtime_pipeline_override: normalizeRealtimePipelineOverride(stateMap.get('realtime_pipeline_override')?.value),
            realtime_pipeline_effective_enabled: realtimePipelineState.effectiveEnabled,
            realtime_pipeline_default_enabled: realtimePipelineState.defaultEnabled,
            realtime_pipeline_override_updated_at: realtimePipelineState.overrideUpdatedAt,
            telphin_legacy_compat_override: normalizeTelphinLegacyCompatOverride(stateMap.get('telphin_legacy_compat_override')?.value),
            telphin_legacy_compat_effective_enabled: telphinLegacyCompatState.effectiveEnabled,
            telphin_legacy_compat_default_enabled: telphinLegacyCompatState.defaultEnabled,
            telphin_legacy_compat_override_updated_at: telphinLegacyCompatState.overrideUpdatedAt,
        };

        const realtimePipeline = await getRealtimePipelineMonitoringSnapshot();
        const transcriptionSlaStatus = buildSlaStatus({
            service: 'Transcription SLA',
            metric: realtimePipeline.metrics.recordingReadyToTranscriptLatency,
            warningP95Seconds: 5 * 60,
            errorP95Seconds: 7 * 60,
            emptyReason: 'Недостаточно завершённых transcription jobs для расчёта SLA.',
        });
        const orderScoreSlaStatus = buildSlaStatus({
            service: 'Order Score SLA',
            metric: realtimePipeline.metrics.orderEventToScoreLatency,
            warningP95Seconds: 2 * 60,
            errorP95Seconds: 3 * 60,
            emptyReason: 'Недостаточно завершённых score jobs для расчёта SLA.',
        });
        const services = [
            telphinStatus,
            retailStatus,
            ...realtimePipeline.services,
            transcriptionSlaStatus,
            orderScoreSlaStatus,
            matchStatus,
            transStatus,
            historyStatus,
            rulesStatus,
            insightStatus,
        ];

        return NextResponse.json({
            services,
            dashboard: services,
            all_rules: allRules || [],
            settings,
            insight_logs: logs,
            pipeline_metrics: realtimePipeline
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { key, value } = body;

        if (!key || value === undefined) {
            return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
        }

        const normalizedValue = key === 'realtime_pipeline_override'
            ? normalizeRealtimePipelineOverride(value)
            : key === 'telphin_legacy_compat_override'
            ? normalizeTelphinLegacyCompatOverride(value)
            : String(value);

        // Whitelist keys for safety if needed, but for now open for sync_state
        // Update sync_state
        const { error } = await supabase
            .from('sync_state')
            .upsert({
                key,
                value: normalizedValue,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        if (error) throw error;

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
