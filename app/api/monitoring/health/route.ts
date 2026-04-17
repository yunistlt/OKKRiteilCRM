
import { NextResponse } from 'next/server';
import { getRealtimePipelineMonitoringSnapshot } from '@/lib/system-jobs-monitoring';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

type HealthCheckItem = {
    name: string;
    healthy: boolean;
    message: string;
    severity?: 'ok' | 'warning' | 'critical';
};

function pushCheck(
    checks: HealthCheckItem[],
    params: { name: string; healthy: boolean; message: string; severity?: 'ok' | 'warning' | 'critical' }
) {
    checks.push({
        name: params.name,
        healthy: params.healthy,
        message: params.message,
        severity: params.severity || (params.healthy ? 'ok' : 'critical'),
    });
}

export async function GET() {
    try {
        const now = new Date();
        const checks: HealthCheckItem[] = [];

        // 1. Check History Sync Freshness
        const { data: lastEvent, error } = await supabase
            .from('raw_order_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single();

        if (error) throw error;

        let isHealthy = true;
        let isDegraded = false;
        let lagMinutes = 0;
        let lastSyncTime = null;
        let message = 'All systems operational.';

        if (lastEvent) {
            lastSyncTime = new Date(lastEvent.occurred_at);
            const diffMs = now.getTime() - lastSyncTime.getTime();
            lagMinutes = Math.floor(diffMs / 1000 / 60);

            // Warning threshold: 2 hours (120 mins)
            if (lagMinutes > 120) {
                isHealthy = false;
                message = `CRITICAL: History Sync stalled! Last event was ${lagMinutes} minutes ago (${lastEvent.occurred_at}).`;
                pushCheck(checks, { name: 'raw_order_events', healthy: false, message, severity: 'critical' });

                // TODO: Integrate Telegram/Email alert here
                // await sendAdminAlert(message);
            } else {
                pushCheck(checks, { name: 'raw_order_events', healthy: true, message: `Lag ${lagMinutes} min`, severity: 'ok' });
            }
        } else {
            isHealthy = false;
            message = 'CRITICAL: No events found in database.';
            pushCheck(checks, { name: 'raw_order_events', healthy: false, message, severity: 'critical' });
        }

        const realtimePipeline = await getRealtimePipelineMonitoringSnapshot();
        const queueSummary = realtimePipeline.summary;

        if (realtimePipeline.enabled && realtimePipeline.queueAvailable) {
            const metrics = realtimePipeline.metrics;
            const serviceByName = new Map(realtimePipeline.services.map((service) => [service.service, service]));

            const criticalChecks = [
                {
                    name: 'system_jobs_pipeline',
                    failing: queueSummary.deadLetterTotal > 0,
                    message: `queued=${queueSummary.queuedTotal}, processing=${queueSummary.processingTotal}, dead_letter=${queueSummary.deadLetterTotal}`,
                },
                {
                    name: 'retailcrm_cursor_lag',
                    failing: metrics.retailcrmCursorLagSeconds !== null && metrics.retailcrmCursorLagSeconds > 30 * 60,
                    message: metrics.retailcrmCursorLagSeconds === null
                        ? 'retailcrm cursor lag unavailable'
                        : `retailcrm cursor lag ${Math.floor(metrics.retailcrmCursorLagSeconds / 60)} min`,
                },
                {
                    name: 'retailcrm_history_cursor_lag',
                    failing: metrics.retailcrmHistoryCursorLagSeconds !== null && metrics.retailcrmHistoryCursorLagSeconds > 45 * 60,
                    message: metrics.retailcrmHistoryCursorLagSeconds === null
                        ? 'retailcrm history cursor lag unavailable'
                        : `retailcrm history lag ${Math.floor(metrics.retailcrmHistoryCursorLagSeconds / 60)} min`,
                },
                {
                    name: 'transcription_queue_oldest',
                    failing: metrics.transcriptionQueueOldestSeconds !== null && metrics.transcriptionQueueOldestSeconds > 20 * 60,
                    message: metrics.transcriptionQueueOldestSeconds === null
                        ? 'transcription queue empty'
                        : `transcription oldest queued ${Math.floor(metrics.transcriptionQueueOldestSeconds / 60)} min`,
                },
                {
                    name: 'semantic_rules_queue_oldest',
                    failing: metrics.semanticRulesQueueOldestSeconds !== null && metrics.semanticRulesQueueOldestSeconds > 20 * 60,
                    message: metrics.semanticRulesQueueOldestSeconds === null
                        ? 'semantic rules queue empty'
                        : `semantic rules oldest queued ${Math.floor(metrics.semanticRulesQueueOldestSeconds / 60)} min`,
                },
                {
                    name: 'score_queue_oldest',
                    failing: metrics.scoreQueueOldestSeconds !== null && metrics.scoreQueueOldestSeconds > 15 * 60,
                    message: metrics.scoreQueueOldestSeconds === null
                        ? 'score refresh queue empty'
                        : `score refresh oldest queued ${Math.floor(metrics.scoreQueueOldestSeconds / 60)} min`,
                },
                {
                    name: 'manager_aggregate_queue_oldest',
                    failing: metrics.managerAggregateQueueOldestSeconds !== null && metrics.managerAggregateQueueOldestSeconds > 30 * 60,
                    message: metrics.managerAggregateQueueOldestSeconds === null
                        ? 'manager aggregate queue empty'
                        : `manager aggregate oldest queued ${Math.floor(metrics.managerAggregateQueueOldestSeconds / 60)} min`,
                },
                {
                    name: 'insight_queue_oldest',
                    failing: metrics.insightQueueOldestSeconds !== null && metrics.insightQueueOldestSeconds > 30 * 60,
                    message: metrics.insightQueueOldestSeconds === null
                        ? 'insight refresh queue empty'
                        : `insight refresh oldest queued ${Math.floor(metrics.insightQueueOldestSeconds / 60)} min`,
                },
                {
                    name: 'dead_letters_last_24h',
                    failing: metrics.recovery.deadLettersLast24h > 0,
                    message: `dead letters 24h = ${metrics.recovery.deadLettersLast24h}`,
                },
            ];

            for (const check of criticalChecks) {
                pushCheck(checks, {
                    name: check.name,
                    healthy: !check.failing,
                    message: check.message,
                    severity: check.failing ? 'critical' : 'ok',
                });
            }

            for (const serviceName of [
                'RetailCRM Delta Queue',
                'RetailCRM History Queue',
                'Call Match Queue',
                'Transcription Queue',
                'Semantic Rules Queue',
                'Score Refresh Queue',
                'Manager Aggregate Queue',
                'Insight Refresh Queue',
            ]) {
                const service = serviceByName.get(serviceName);
                if (!service) continue;

                const isCritical = service.status === 'error';
                const isWarning = service.status === 'warning';
                if (isCritical) isHealthy = false;
                if (isWarning) isDegraded = true;

                pushCheck(checks, {
                    name: serviceName,
                    healthy: service.status !== 'error',
                    message: `${service.details}${service.reason ? `; ${service.reason}` : ''}`,
                    severity: isCritical ? 'critical' : (isWarning ? 'warning' : 'ok'),
                });
            }

            if (criticalChecks.some((check) => check.failing)) {
                isHealthy = false;
                message = 'CRITICAL: system-jobs pipeline lagging, dead letters detected, or critical queue SLA exceeded.';
            } else if (checks.some((check) => check.severity === 'warning')) {
                isDegraded = true;
                message = 'WARNING: system healthy but one or more queues are approaching SLA thresholds.';
            }
        } else {
            pushCheck(checks, {
                name: 'system_jobs_pipeline',
                healthy: true,
                message: realtimePipeline.enabled ? 'system_jobs migration not applied yet' : 'pipeline disabled by feature flag',
                severity: 'warning',
            });
            isDegraded = true;
        }

        return NextResponse.json({
            success: true,
            healthy: isHealthy,
            degraded: isDegraded && isHealthy,
            lag_minutes: lagMinutes,
            last_sync: lastSyncTime,
            message: message,
            checked_at: now.toISOString(),
            checks,
            queue_summary: queueSummary,
            pipeline_metrics: realtimePipeline.metrics,
            pipeline_services: realtimePipeline.services,
        });

    } catch (e: any) {
        return NextResponse.json({
            success: false,
            healthy: false,
            message: `Health Check Failed: ${e.message}`
        }, { status: 500 });
    }
}
