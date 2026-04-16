
// ОТВЕТСТВЕННЫЙ: ИГОРЬ (Диспетчер) — Системный аудитор: проверка здоровья базы и зависших процессов.
import { NextResponse } from 'next/server';
import { getRealtimePipelineMonitoringSnapshot } from '@/lib/system-jobs-monitoring';
import { supabase } from '@/utils/supabase';
import { sendTelegramNotification } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const ALERT_HASH_KEY = 'system_audit_realtime_alert_hash';
const ALERT_SENT_AT_KEY = 'system_audit_realtime_alert_sent_at';
const ALERT_RECOVERED_AT_KEY = 'system_audit_realtime_alert_recovered_at';
const ALERT_COOLDOWN_HOURS = 6;

function hoursSince(dateStr?: string | null) {
    if (!dateStr) return null;
    return (Date.now() - new Date(dateStr).getTime()) / (60 * 60 * 1000);
}

function buildAlertHash(lines: string[]) {
    return lines.join('|').slice(0, 1000);
}

async function loadAlertState() {
    const { data, error } = await supabase
        .from('sync_state')
        .select('key, value, updated_at')
        .in('key', [ALERT_HASH_KEY, ALERT_SENT_AT_KEY, ALERT_RECOVERED_AT_KEY]);

    if (error) throw error;

    const map = new Map<string, { value: string; updated_at: string }>();
    (data || []).forEach((item: any) => map.set(item.key, item));
    return map;
}

async function persistAlertState(entries: Array<{ key: string; value: string }>) {
    if (!entries.length) return;

    const { error } = await supabase
        .from('sync_state')
        .upsert(entries.map((entry) => ({
            key: entry.key,
            value: entry.value,
            updated_at: new Date().toISOString(),
        })), { onConflict: 'key' });

    if (error) throw error;
}

export async function GET(req: Request) {
    const report: string[] = [];
    let hasAnomalies = false;
    let realtimeAlertLines: string[] = [];

    try {
        console.log('[SystemAuditor] Starting check...');

        // 1. Check for Stuck Transcriptions (Pending > 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { count: pendingCount, error: pendingError } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .eq('transcription_status', 'pending')
            .lt('started_at', twoHoursAgo);

        if (pendingError) {
            report.push(`❌ DB Error (Pending Check): ${pendingError.message}`);
            hasAnomalies = true;
        } else if (pendingCount !== null && pendingCount > 0) {
            report.push(`⚠️ <b>Stuck Transcriptions:</b> ${pendingCount} calls (pending > 2h). Billing risk!`);
            hasAnomalies = true;
        } else {
            report.push(`✅ Transcriptions: OK (0 stuck)`);
        }

        // 2. Check Recent Violations (Did analysis run in last 24h?)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: violCount, error: violError } = await supabase
            .from('okk_violations')
            .select('*', { count: 'exact', head: true })
            .gte('violation_time', oneDayAgo);

        if (violError) {
            report.push(`❌ DB Error (Violations Check): ${violError.message}`);
            hasAnomalies = true;
        } else if (violCount === 0) {
            // Not necessarily a critical error, but worth noting if we expect them daily
            report.push(`ℹ️ <b>No violations in 24h</b>. System quiet or analysis broken?`);
        } else {
            report.push(`✅ Violations: ${violCount} found in last 24h.`);
        }

        // 3. Database Connection Test (Simple Fetch)
        const { error: dbError } = await supabase.from('okk_rules').select('count', { count: 'exact', head: true });
        if (dbError) {
            report.push(`❌ <b>DB Connection Failed:</b> ${dbError.message}`);
            hasAnomalies = true;
        } else {
            report.push(`✅ DB Connection: OK`);
        }

        const realtimePipeline = await getRealtimePipelineMonitoringSnapshot();
        if (realtimePipeline.enabled && realtimePipeline.queueAvailable) {
            const metrics = realtimePipeline.metrics;
            const summary = realtimePipeline.summary;

            if (summary.deadLetterTotal > 0) {
                realtimeAlertLines.push(`dead-letter задач: ${summary.deadLetterTotal}`);
            }
            if (metrics.retailcrmCursorLagSeconds !== null && metrics.retailcrmCursorLagSeconds > 10 * 60) {
                realtimeAlertLines.push(`lag RetailCRM cursor: ${Math.floor(metrics.retailcrmCursorLagSeconds / 60)} мин`);
            }
            if (metrics.retailcrmHistoryCursorLagSeconds !== null && metrics.retailcrmHistoryCursorLagSeconds > 20 * 60) {
                realtimeAlertLines.push(`lag RetailCRM history cursor: ${Math.floor(metrics.retailcrmHistoryCursorLagSeconds / 60)} мин`);
            }
            if (metrics.transcriptionQueueOldestSeconds !== null && metrics.transcriptionQueueOldestSeconds > 10 * 60) {
                realtimeAlertLines.push(`очередь транскрибации ждёт: ${Math.floor(metrics.transcriptionQueueOldestSeconds / 60)} мин`);
            }
            if (metrics.managerAggregateQueueOldestSeconds !== null && metrics.managerAggregateQueueOldestSeconds > 15 * 60) {
                realtimeAlertLines.push(`очередь manager_aggregate_refresh ждёт: ${Math.floor(metrics.managerAggregateQueueOldestSeconds / 60)} мин`);
            }
            if (metrics.scoreQueueOldestSeconds !== null && metrics.scoreQueueOldestSeconds > 5 * 60) {
                realtimeAlertLines.push(`очередь score_refresh ждёт: ${Math.floor(metrics.scoreQueueOldestSeconds / 60)} мин`);
            }
            if (metrics.insightQueueOldestSeconds !== null && metrics.insightQueueOldestSeconds > 20 * 60) {
                realtimeAlertLines.push(`очередь insight_refresh ждёт: ${Math.floor(metrics.insightQueueOldestSeconds / 60)} мин`);
            }
            if (metrics.scoreToAggregateLatency.p95Seconds !== null && metrics.scoreToAggregateLatency.p95Seconds > 10 * 60) {
                realtimeAlertLines.push(`p95 score→aggregate latency: ${Math.floor(metrics.scoreToAggregateLatency.p95Seconds / 60)} мин`);
            }
            if (metrics.transcriptionLatency.p95Seconds !== null && metrics.transcriptionLatency.p95Seconds > 20 * 60) {
                realtimeAlertLines.push(`p95 transcription latency: ${Math.floor(metrics.transcriptionLatency.p95Seconds / 60)} мин`);
            }

            if (realtimeAlertLines.length > 0) {
                hasAnomalies = true;
                report.push(`⚠️ <b>Realtime pipeline SLA:</b> ${realtimeAlertLines.join('; ')}`);
            } else {
                report.push('✅ Realtime pipeline SLA: OK');
            }
        } else if (realtimePipeline.enabled && !realtimePipeline.queueAvailable) {
            report.push('ℹ️ Realtime pipeline включен, но `system_jobs` migration ещё не применена.');
        } else {
            report.push('ℹ️ Realtime pipeline отключен feature flag-ом.');
        }

        // Send Alert if Anomalies Found or periodically (e.g. daily summary)
        // Since this runs every 4 hours, and user wants "status", we might alert only on error for now?
        // OR always send a "System Health: OK" message? User asked for "control", implies visibility.
        // Let's send only if Anomalies OR if it's the 12:00 run?
        // Actually user said "chat telegram", implying they want to see it.
        // But every 4 hours might be spammy if everything is OK.
        // Let's send if anomalies found.

        const alertState = await loadAlertState();
        const previousHash = alertState.get(ALERT_HASH_KEY)?.value || '';
        const previousSentAt = alertState.get(ALERT_SENT_AT_KEY)?.value || null;
        const alertHash = realtimeAlertLines.length > 0 ? buildAlertHash(realtimeAlertLines) : '';
        const shouldSendRealtimeAlert = realtimeAlertLines.length > 0 && (
            alertHash !== previousHash ||
            previousSentAt === null ||
            (hoursSince(previousSentAt) !== null && hoursSince(previousSentAt)! >= ALERT_COOLDOWN_HOURS)
        );

        if (hasAnomalies) {
            const message = `
<b>🤖 System Auditor Alert</b>
${report.join('\n')}
             `.trim();

            if (!realtimeAlertLines.length || shouldSendRealtimeAlert) {
                await sendTelegramNotification(message);
            }

            if (realtimeAlertLines.length > 0) {
                await persistAlertState([
                    { key: ALERT_HASH_KEY, value: alertHash },
                    { key: ALERT_SENT_AT_KEY, value: new Date().toISOString() },
                ]);
            }
        } else {
            console.log('[SystemAuditor] All systems nominal. No alert sent.');
            if (previousHash) {
                await sendTelegramNotification('<b>✅ Realtime pipeline recovered</b>\nLag и backlog вернулись в допустимые пределы.');
                await persistAlertState([
                    { key: ALERT_HASH_KEY, value: '' },
                    { key: ALERT_RECOVERED_AT_KEY, value: new Date().toISOString() },
                ]);
            }
            // Uncomment to verify functionality initially:
            // await sendTelegramNotification(`<b>🤖 System Auditor: OK</b>\nNo anomalies found.`);
        }

        return NextResponse.json({
            success: !hasAnomalies,
            report
        });

    } catch (e: any) {
        console.error('[SystemAuditor] Fatal Error:', e);
        await sendTelegramNotification(`<b>🚨 System Auditor CRASHED</b>\n${e.message}`);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
