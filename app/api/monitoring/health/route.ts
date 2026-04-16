
import { NextResponse } from 'next/server';
import { getRealtimePipelineMonitoringSnapshot } from '@/lib/system-jobs-monitoring';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const now = new Date();
        const checks: Array<{ name: string; healthy: boolean; message: string }> = [];

        // 1. Check History Sync Freshness
        const { data: lastEvent, error } = await supabase
            .from('raw_order_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single();

        if (error) throw error;

        let isHealthy = true;
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
                checks.push({ name: 'raw_order_events', healthy: false, message });

                // TODO: Integrate Telegram/Email alert here
                // await sendAdminAlert(message);
            } else {
                checks.push({ name: 'raw_order_events', healthy: true, message: `Lag ${lagMinutes} min` });
            }
        } else {
            isHealthy = false;
            message = 'CRITICAL: No events found in database.';
            checks.push({ name: 'raw_order_events', healthy: false, message });
        }

        const realtimePipeline = await getRealtimePipelineMonitoringSnapshot();
        const queueSummary = realtimePipeline.summary;

        if (realtimePipeline.enabled && realtimePipeline.queueAvailable) {
            const criticalQueueIssue =
                queueSummary.deadLetterTotal > 0 ||
                (realtimePipeline.metrics.retailcrmCursorLagSeconds !== null && realtimePipeline.metrics.retailcrmCursorLagSeconds > 30 * 60) ||
                (realtimePipeline.metrics.scoreQueueOldestSeconds !== null && realtimePipeline.metrics.scoreQueueOldestSeconds > 15 * 60) ||
                (realtimePipeline.metrics.semanticRulesQueueOldestSeconds !== null && realtimePipeline.metrics.semanticRulesQueueOldestSeconds > 20 * 60) ||
                (realtimePipeline.metrics.transcriptionQueueOldestSeconds !== null && realtimePipeline.metrics.transcriptionQueueOldestSeconds > 20 * 60);

            checks.push({
                name: 'system_jobs_pipeline',
                healthy: !criticalQueueIssue,
                message: `queued=${queueSummary.queuedTotal}, processing=${queueSummary.processingTotal}, dead_letter=${queueSummary.deadLetterTotal}`,
            });

            if (criticalQueueIssue) {
                isHealthy = false;
                message = 'CRITICAL: system-jobs pipeline lagging or dead-letter backlog detected.';
            }
        } else {
            checks.push({
                name: 'system_jobs_pipeline',
                healthy: true,
                message: realtimePipeline.enabled ? 'system_jobs migration not applied yet' : 'pipeline disabled by feature flag',
            });
        }

        return NextResponse.json({
            success: true,
            healthy: isHealthy,
            lag_minutes: lagMinutes,
            last_sync: lastSyncTime,
            message: message,
            checked_at: now.toISOString(),
            checks,
            queue_summary: queueSummary,
            pipeline_metrics: realtimePipeline.metrics
        });

    } catch (e: any) {
        return NextResponse.json({
            success: false,
            healthy: false,
            message: `Health Check Failed: ${e.message}`
        }, { status: 500 });
    }
}
