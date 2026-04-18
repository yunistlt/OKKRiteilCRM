import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { getRealtimePipelineMonitoringSnapshot } from '@/lib/system-jobs-monitoring';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

type RecentCompletedJobRow = {
  job_type: string;
  payload: Record<string, any> | null;
  queued_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
};

function formatLatency(seconds: number | null) {
  if (seconds === null) return 'n/a';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatDate(value: string | null) {
  if (!value) return 'n/a';
  return new Date(value).toISOString();
}

function formatStatus(status: string) {
  if (status === 'ok') return 'OK';
  if (status === 'warning') return 'WARNING';
  return 'ERROR';
}

function getLeadTimeSeconds(row: RecentCompletedJobRow) {
  if (!row.queued_at || !row.finished_at) return null;
  const queuedAt = new Date(row.queued_at).getTime();
  const finishedAt = new Date(row.finished_at).getTime();
  if (Number.isNaN(queuedAt) || Number.isNaN(finishedAt) || finishedAt < queuedAt) {
    return null;
  }

  return Math.floor((finishedAt - queuedAt) / 1000);
}

function formatRecentJobTable(params: {
  title: string;
  rows: RecentCompletedJobRow[];
  idKey: 'order_id' | 'telphin_call_id';
  idLabel: string;
}) {
  const { title, rows, idKey, idLabel } = params;

  const lines = [
    `## ${title}`,
    '',
    `| ${idLabel} | Queued At | Finished At | Lead Time |`,
    '| --- | --- | --- | --- |',
  ];

  if (!rows.length) {
    lines.push(`| n/a | n/a | n/a | no recent completed jobs |`);
    lines.push('');
    return lines.join('\n');
  }

  rows.forEach((row) => {
    const identifier = String(row.payload?.[idKey] || 'n/a');
    lines.push(
      `| ${identifier} | ${formatDate(row.queued_at)} | ${formatDate(row.finished_at)} | ${formatLatency(getLeadTimeSeconds(row))} |`
    );
  });

  lines.push('');
  return lines.join('\n');
}

async function getRecentCompletedJobs(jobType: 'call_transcription' | 'order_score_refresh', limit: number) {
  const { data, error } = await supabase
    .from('system_jobs')
    .select('job_type, payload, queued_at, finished_at, updated_at')
    .eq('job_type', jobType)
    .eq('status', 'completed')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || []) as RecentCompletedJobRow[];
}

export async function GET() {
  const session = await getSession();
  if (!hasAnyRole(session, ['admin'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const snapshot = await getRealtimePipelineMonitoringSnapshot();
  const [recentTranscriptions, recentScores] = await Promise.all([
    getRecentCompletedJobs('call_transcription', 5),
    getRecentCompletedJobs('order_score_refresh', 5),
  ]);

  const markdown = [
    '# OKK Realtime Lag Measurements',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Pipeline State',
    '',
    `- Realtime pipeline enabled: ${snapshot.enabled ? 'yes' : 'no'}`,
    `- Queue available: ${snapshot.queueAvailable ? 'yes' : 'no'}`,
    `- Queue backlog: queued ${snapshot.summary.queuedTotal}, processing ${snapshot.summary.processingTotal}, dead-letter ${snapshot.summary.deadLetterTotal}`,
    `- Oldest queued job: ${snapshot.summary.oldestQueuedMinutes === null ? 'n/a' : `${snapshot.summary.oldestQueuedMinutes}m`}`,
    '',
    '## SLA Snapshot',
    '',
    `- Order freshness: ${formatStatus(snapshot.sla.indicators.orderFreshnessStatus)}; indicator ${formatLatency(snapshot.sla.indicators.orderFreshnessSeconds)}; target ${formatLatency(snapshot.sla.targets.orderFreshnessSeconds)}`,
    `- Recording ready -> transcript p95: ${formatStatus(snapshot.sla.indicators.transcriptionReadyStatus)}; current ${formatLatency(snapshot.sla.indicators.transcriptionReadyP95Seconds)}; target ${formatLatency(snapshot.sla.targets.transcriptionReadySeconds)}`,
    `- Order event -> score p95: ${formatStatus(snapshot.sla.indicators.scoreRefreshStatus)}; current ${formatLatency(snapshot.sla.indicators.scoreRefreshP95Seconds)}; target ${formatLatency(snapshot.sla.targets.scoreRefreshSeconds)}`,
    '',
    '## Core Lag Metrics',
    '',
    `- retailcrm_cursor_lag_seconds: ${formatLatency(snapshot.metrics.retailcrmCursorLagSeconds)}`,
    `- retailcrm_history_cursor_lag_seconds: ${formatLatency(snapshot.metrics.retailcrmHistoryCursorLagSeconds)}`,
    `- oldest_transcription_job_seconds: ${formatLatency(snapshot.metrics.transcriptionQueueOldestSeconds)}`,
    `- oldest_score_refresh_job_seconds: ${formatLatency(snapshot.metrics.scoreQueueOldestSeconds)}`,
    `- transcription_p95_seconds: ${formatLatency(snapshot.metrics.transcriptionLatency.p95Seconds)} (samples ${snapshot.metrics.transcriptionLatency.sampleSize})`,
    `- score_refresh_p95_seconds: ${formatLatency(snapshot.metrics.scoreRefreshLatency.p95Seconds)} (samples ${snapshot.metrics.scoreRefreshLatency.sampleSize})`,
    `- order_event_to_score_p95_seconds: ${formatLatency(snapshot.metrics.orderEventToScoreLatency.p95Seconds)} (samples ${snapshot.metrics.orderEventToScoreLatency.sampleSize})`,
    '',
    '## Queue Stages',
    '',
    '| Stage | Status | Queued | Processing | Limit | Oldest Queued | Dead Letter |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...Object.values(snapshot.queueStages).map((stage) =>
      `| ${stage.service} | ${formatStatus(stage.status)} | ${stage.queued} | ${stage.processing} | ${stage.processingLimit ?? 'n/a'} | ${formatLatency(stage.oldestQueuedSeconds)} | ${stage.deadLetter} |`
    ),
    '',
    '## Hotspot',
    '',
    `- Queue: ${snapshot.hotspotSummary.queue?.service || 'n/a'}`,
    `- Operator message: ${snapshot.hotspotSummary.operatorMessage || 'n/a'}`,
    `- Dominant retry cause: ${snapshot.hotspotSummary.dominantRetryCause ? `${snapshot.hotspotSummary.dominantRetryCause.kind} (${snapshot.hotspotSummary.dominantRetryCause.count})` : 'n/a'}`,
    '',
    '## Recovery Metrics',
    '',
    `- completed_last_24h: ${snapshot.metrics.recovery.completedLast24h}`,
    `- retry_attempts_last_24h: ${snapshot.metrics.recovery.retryAttemptsLast24h}`,
    `- retried_jobs_last_24h: ${snapshot.metrics.recovery.retriedJobsLast24h}`,
    `- dead_letters_last_24h: ${snapshot.metrics.recovery.deadLettersLast24h}`,
    `- retry_backlog_by_kind: ${JSON.stringify(snapshot.metrics.recovery.retryBacklogByKind)}`,
    '',
    formatRecentJobTable({
      title: 'Recent Completed Transcription Jobs',
      rows: recentTranscriptions,
      idKey: 'telphin_call_id',
      idLabel: 'Call ID',
    }),
    formatRecentJobTable({
      title: 'Recent Completed Score Refresh Jobs',
      rows: recentScores,
      idKey: 'order_id',
      idLabel: 'Order ID',
    }),
  ].join('\n');

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `inline; filename="okk-realtime-lag-report-${new Date().toISOString().slice(0, 10)}.md"`,
    },
  });
}