import { isCronHeaderAuthorized } from '@/lib/cron-auth';

// ОТВЕТСТВЕННЫЙ: ИГОРЬ (Диспетчер) — Системный аудитор: проверка здоровья базы и зависших процессов.
import { NextRequest, NextResponse } from 'next/server';
import { getRealtimePipelineMonitoringSnapshot } from '@/lib/system-jobs-monitoring';
import { REALTIME_SLA_THRESHOLDS } from '@/lib/realtime-sla';
import { supabase } from '@/utils/supabase';
import { sendTelegramTechNotification } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const ALERT_HASH_KEY = 'system_audit_realtime_alert_hash';
const ALERT_SENT_AT_KEY = 'system_audit_realtime_alert_sent_at';
const ALERT_RECOVERED_AT_KEY = 'system_audit_realtime_alert_recovered_at';
const ALERT_COOLDOWN_HOURS = 6;

function ensureAuthorized(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        throw new Error('Unauthorized');
    }
}

function formatRetryBacklogByKind(retryBacklogByKind: Record<string, number>) {
    const entries = Object.entries(retryBacklogByKind)
        .filter(([, count]) => count > 0)
        .sort((left, right) => right[1] - left[1]);

    if (!entries.length) return null;

    return entries
        .map(([kind, count]) => `${kind}: ${count}`)
        .join(', ');
}

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

export async function GET(req: NextRequest) {
    const report: string[] = [];
    let hasAnomalies = false;
    let realtimeAlertLines: string[] = [];

    try {
        ensureAuthorized(req);
        console.log('[SystemAuditor] Starting check...');

        // 1. Застрявшие расшифровки — только те, где есть что расшифровывать.
        //    Без фильтра по записи сюда попадали недозвоны и соединения с голосовым меню:
        //    расшифровать их нельзя никогда, и счётчик показывал вечные 6965 «застрявших».
        //    Тревога, которая горит всегда, — это не тревога.
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { count: pendingCount, error: pendingError } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .in('transcription_status', ['pending', 'ready_for_transcription', 'processing'])
            .not('recording_url', 'is', null)
            .lt('started_at', twoHoursAgo);

        if (pendingError) {
            report.push(`❌ Ошибка базы при проверке очереди расшифровок: ${pendingError.message}`);
            hasAnomalies = true;
        } else if (pendingCount !== null && pendingCount > 0) {
            report.push(`⚠️ <b>Расшифровки застряли:</b> ${pendingCount} звонков ждут дольше 2 часов. Есть риск переплаты.`);
            hasAnomalies = true;
        } else {
            report.push(`✅ Расшифровки: всё в порядке, застрявших нет`);
        }

        // 2. Check Recent Violations (Did analysis run in last 24h?)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: violCount, error: violError } = await supabase
            .from('okk_violations')
            .select('*', { count: 'exact', head: true })
            .gte('violation_time', oneDayAgo);

        if (violError) {
            report.push(`❌ Ошибка базы при проверке нарушений: ${violError.message}`);
            hasAnomalies = true;
        } else if (violCount === 0) {
            // Not necessarily a critical error, but worth noting if we expect them daily
            report.push(`ℹ️ <b>За сутки не найдено ни одного нарушения.</b> Либо и правда тихо, либо сломался разбор — стоит проверить.`);
        } else {
            report.push(`✅ Нарушения: за сутки найдено ${violCount}`);
        }

        // 3. Database Connection Test (Simple Fetch)
        const { error: dbError } = await supabase.from('okk_rules').select('count', { count: 'exact', head: true });
        if (dbError) {
            report.push(`❌ <b>Нет связи с базой:</b> ${dbError.message}`);
            hasAnomalies = true;
        } else {
            report.push(`✅ Связь с базой: в порядке`);
        }

        const realtimePipeline = await getRealtimePipelineMonitoringSnapshot();
        if (realtimePipeline.enabled && realtimePipeline.queueAvailable) {
            const metrics = realtimePipeline.metrics;
            const summary = realtimePipeline.summary;
            const sla = realtimePipeline.sla;

            if (summary.deadLetterTotal > 0) {
                realtimeAlertLines.push(`dead-letter задач: ${summary.deadLetterTotal}`);
            }
            if (sla.indicators.orderFreshnessSeconds !== null && sla.indicators.orderFreshnessSeconds > REALTIME_SLA_THRESHOLDS.orderFreshness.criticalSeconds) {
                realtimeAlertLines.push(`свежесть заказа в ОКК: ${Math.floor(sla.indicators.orderFreshnessSeconds / 60)} мин`);
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
            if (metrics.orderEventToScoreLatency.p95Seconds !== null && metrics.orderEventToScoreLatency.p95Seconds > REALTIME_SLA_THRESHOLDS.scoreRefresh.criticalSeconds) {
                realtimeAlertLines.push(`p95 event→score latency: ${Math.floor(metrics.orderEventToScoreLatency.p95Seconds / 60)} мин`);
            }
            if (metrics.recordingReadyToTranscriptLatency.p95Seconds !== null && metrics.recordingReadyToTranscriptLatency.p95Seconds > REALTIME_SLA_THRESHOLDS.transcriptionReady.criticalSeconds) {
                realtimeAlertLines.push(`p95 recording_ready→transcript latency: ${Math.floor(metrics.recordingReadyToTranscriptLatency.p95Seconds / 60)} мин`);
            }
            if (metrics.scoreToAggregateLatency.p95Seconds !== null && metrics.scoreToAggregateLatency.p95Seconds > 10 * 60) {
                realtimeAlertLines.push(`p95 score→aggregate latency: ${Math.floor(metrics.scoreToAggregateLatency.p95Seconds / 60)} мин`);
            }
            if (metrics.transcriptionLatency.p95Seconds !== null && metrics.transcriptionLatency.p95Seconds > 20 * 60) {
                realtimeAlertLines.push(`p95 transcription latency: ${Math.floor(metrics.transcriptionLatency.p95Seconds / 60)} мин`);
            }
            if (metrics.callMatchToAggregateLatency.p95Seconds !== null && metrics.callMatchToAggregateLatency.p95Seconds > 15 * 60) {
                realtimeAlertLines.push(`p95 call_match→aggregate latency: ${Math.floor(metrics.callMatchToAggregateLatency.p95Seconds / 60)} мин`);
            }
            if (metrics.recovery.deadLettersLast24h > 0) {
                realtimeAlertLines.push(`dead-letter за 24ч: ${metrics.recovery.deadLettersLast24h}`);
            }
            if (metrics.recovery.retryAttemptsLast24h > 20) {
                realtimeAlertLines.push(`retry attempts за 24ч: ${metrics.recovery.retryAttemptsLast24h}`);
            }
            const retryBacklogSummary = formatRetryBacklogByKind(metrics.recovery.retryBacklogByKind);
            if (retryBacklogSummary) {
                realtimeAlertLines.push(`retry backlog по причинам: ${retryBacklogSummary}`);
            }
            const dominantRetryCause = realtimePipeline.hotspotSummary.dominantRetryCause;
            if (dominantRetryCause) {
                realtimeAlertLines.push(`доминирующая причина retry: ${dominantRetryCause.kind} (${dominantRetryCause.count})`);
            }
            const queueHotspot = realtimePipeline.hotspotSummary.queue;
            if (queueHotspot) {
                const parts = [`queued ${queueHotspot.queued}`];
                if (queueHotspot.processing > 0) parts.push(`processing ${queueHotspot.processing}`);
                if (queueHotspot.deadLetter > 0) parts.push(`dead-letter ${queueHotspot.deadLetter}`);
                if (queueHotspot.oldestQueuedSeconds !== null) parts.push(`oldest ${Math.floor(queueHotspot.oldestQueuedSeconds / 60)} мин`);
                realtimeAlertLines.push(`главная проблемная очередь: ${queueHotspot.service}: ${parts.join(', ')}`);
                if (queueHotspot.lastErrorSnippet) {
                    realtimeAlertLines.push(`последняя ошибка hotspot: ${queueHotspot.lastErrorSnippet}`);
                }
            }

            if (realtimeAlertLines.length > 0) {
                hasAnomalies = true;
                report.push(`⚠️ <b>Конвейер не укладывается в норматив:</b> ${realtimeAlertLines.join('; ')}`);
            } else {
                report.push('✅ Конвейер укладывается в норматив');
            }
        } else if (realtimePipeline.enabled && !realtimePipeline.queueAvailable) {
            report.push('ℹ️ Конвейер включён, но миграция очереди работ (`system_jobs`) ещё не применена.');
        } else {
            report.push('ℹ️ Конвейер выключен рубильником в настройках.');
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
<b>🤖 Системный аудитор: есть вопросы</b>
${report.join('\n')}
             `.trim();

            if (!realtimeAlertLines.length || shouldSendRealtimeAlert) {
                await sendTelegramTechNotification(message);
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
                await sendTelegramTechNotification('<b>✅ Конвейер вошёл в норму</b>\nОтставание и очередь вернулись в допустимые пределы.');
                await persistAlertState([
                    { key: ALERT_HASH_KEY, value: '' },
                    { key: ALERT_RECOVERED_AT_KEY, value: new Date().toISOString() },
                ]);
            }
            // Uncomment to verify functionality initially:
            // await sendTelegramTechNotification(`<b>🤖 System Auditor: OK</b>\nNo anomalies found.`);
        }

        return NextResponse.json({
            success: !hasAnomalies,
            report
        });

    } catch (e: any) {
        console.error('[SystemAuditor] Fatal Error:', e);
        if (e.message !== 'Unauthorized') {
            await sendTelegramTechNotification(`<b>🚨 Системный аудитор упал</b>\n${e.message}`);
        }
        const isUnauthorized = e.message === 'Unauthorized';
        return NextResponse.json({ error: e.message }, { status: isUnauthorized ? 401 : 500 });
    }
}
