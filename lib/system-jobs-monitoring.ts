import { supabase } from '@/utils/supabase';

type MonitorStatus = 'ok' | 'warning' | 'error';

export interface MonitorServiceStatus {
  service: string;
  cursor: string;
  last_run: string | null;
  status: MonitorStatus;
  details: string;
  reason?: string | null;
}

interface QueueSummary {
  queuedTotal: number;
  processingTotal: number;
  deadLetterTotal: number;
  oldestQueuedMinutes: number | null;
}

export interface RealtimePipelineMonitoringSnapshot {
  enabled: boolean;
  queueAvailable: boolean;
  summary: QueueSummary;
  metrics: {
    retailcrmCursorLagSeconds: number | null;
    retailcrmHistoryCursorLagSeconds: number | null;
    transcriptionQueueOldestSeconds: number | null;
    scoreQueueOldestSeconds: number | null;
    insightQueueOldestSeconds: number | null;
  };
  services: MonitorServiceStatus[];
}

type JobRow = {
  job_type: string;
  status: string;
  queued_at: string | null;
  available_at: string | null;
  started_at: string | null;
  lock_expires_at: string | null;
};

const MONITORED_JOB_TYPES = [
  'retailcrm_order_delta_pull',
  'retailcrm_history_delta_pull',
  'retailcrm_order_upsert',
  'call_match',
  'call_transcription',
  'order_score_refresh',
  'order_insight_refresh',
] as const;

function isMissingSystemJobsError(error: any) {
  return (
    error?.code === '42P01' ||
    error?.message?.includes('system_jobs') ||
    error?.message?.includes('relation')
  );
}

function secondsSince(dateStr?: string | null) {
  if (!dateStr) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
}

function minutesSince(dateStr?: string | null) {
  const seconds = secondsSince(dateStr);
  if (seconds === null) return null;
  return Math.floor(seconds / 60);
}

function formatAge(minutes: number | null) {
  if (minutes === null) return 'n/a';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${restMinutes}m`;
}

function countJobs(rows: JobRow[], jobTypes: string[], status?: string) {
  return rows.filter((row) => jobTypes.includes(row.job_type) && (!status || row.status === status)).length;
}

function oldestQueuedMinutes(rows: JobRow[], jobTypes: string[]) {
  const timestamps = rows
    .filter((row) => jobTypes.includes(row.job_type) && row.status === 'queued' && row.queued_at)
    .map((row) => minutesSince(row.queued_at))
    .filter((value): value is number => value !== null);

  if (!timestamps.length) return null;
  return Math.max(...timestamps);
}

function buildQueueService(params: {
  service: string;
  cursor?: string | null;
  lastRun?: string | null;
  queued: number;
  processing: number;
  deadLetter?: number;
  oldestQueuedMinutes?: number | null;
  warningMinutes?: number;
  errorMinutes?: number;
  warningQueued?: number;
  errorQueued?: number;
  disabledReason?: string | null;
}): MonitorServiceStatus {
  if (params.disabledReason) {
    return {
      service: params.service,
      cursor: params.cursor || 'Disabled',
      last_run: params.lastRun || null,
      status: 'warning',
      details: 'Disabled',
      reason: params.disabledReason,
    };
  }

  const deadLetter = params.deadLetter ?? 0;
  const oldestMinutes = params.oldestQueuedMinutes ?? null;
  const warningMinutes = params.warningMinutes ?? 10;
  const errorMinutes = params.errorMinutes ?? 30;
  const warningQueued = params.warningQueued ?? 10;
  const errorQueued = params.errorQueued ?? 50;

  let status: MonitorStatus = 'ok';
  let reason: string | null = null;

  if (deadLetter > 0) {
    status = 'error';
    reason = `Есть dead-letter задачи: ${deadLetter}`;
  } else if ((oldestMinutes !== null && oldestMinutes >= errorMinutes) || params.queued >= errorQueued) {
    status = 'error';
    reason = `Backlog критический: queued ${params.queued}, oldest ${formatAge(oldestMinutes)}`;
  } else if ((oldestMinutes !== null && oldestMinutes >= warningMinutes) || params.queued >= warningQueued) {
    status = 'warning';
    reason = `Backlog растет: queued ${params.queued}, oldest ${formatAge(oldestMinutes)}`;
  }

  return {
    service: params.service,
    cursor: params.cursor || 'System Jobs',
    last_run: params.lastRun || null,
    status,
    details: `queued ${params.queued}, processing ${params.processing}, oldest ${formatAge(oldestMinutes)}`,
    reason,
  };
}

export async function getRealtimePipelineMonitoringSnapshot(): Promise<RealtimePipelineMonitoringSnapshot> {
  const enabled = process.env.ENABLE_SYSTEM_JOBS_PIPELINE === 'true';

  const { data: syncStates, error: syncError } = await supabase
    .from('sync_state')
    .select('key, value, updated_at')
    .in('key', [
      'retailcrm_orders_sync',
      'retailcrm_history_sync',
      'retailcrm_orders_queue_last_success_at',
      'retailcrm_history_queue_last_success_at',
    ]);

  if (syncError) {
    throw syncError;
  }

  const stateMap = new Map<string, { value: string; updated_at: string }>();
  (syncStates || []).forEach((state: any) => stateMap.set(state.key, state));

  let rows: JobRow[] = [];
  let queueAvailable = true;

  try {
    const { data, error } = await supabase
      .from('system_jobs')
      .select('job_type, status, queued_at, available_at, started_at, lock_expires_at')
      .in('job_type', [...MONITORED_JOB_TYPES])
      .in('status', ['queued', 'processing', 'dead_letter']);

    if (error) throw error;
    rows = (data || []) as JobRow[];
  } catch (error: any) {
    if (!isMissingSystemJobsError(error)) {
      throw error;
    }
    queueAvailable = false;
  }

  const queuedTotal = countJobs(rows, [...MONITORED_JOB_TYPES], 'queued');
  const processingTotal = countJobs(rows, [...MONITORED_JOB_TYPES], 'processing');
  const deadLetterTotal = countJobs(rows, [...MONITORED_JOB_TYPES], 'dead_letter');
  const oldestQueuedOverall = oldestQueuedMinutes(rows, [...MONITORED_JOB_TYPES]);

  const retailcrmCursor = stateMap.get('retailcrm_orders_sync')?.value || null;
  const retailcrmHistoryCursor = stateMap.get('retailcrm_history_sync')?.value || null;
  const queueDisabledReason = !enabled
    ? 'ENABLE_SYSTEM_JOBS_PIPELINE=false'
    : (!queueAvailable ? 'system_jobs migration еще не применена' : null);

  const transcriptionOldest = oldestQueuedMinutes(rows, ['call_transcription']);
  const scoreOldest = oldestQueuedMinutes(rows, ['order_score_refresh']);
  const insightOldest = oldestQueuedMinutes(rows, ['order_insight_refresh']);

  const services: MonitorServiceStatus[] = [
    buildQueueService({
      service: 'System Jobs Queue',
      cursor: enabled ? 'Near Realtime Pipeline' : 'Disabled',
      lastRun: stateMap.get('retailcrm_orders_queue_last_success_at')?.updated_at || null,
      queued: queuedTotal,
      processing: processingTotal,
      deadLetter: deadLetterTotal,
      oldestQueuedMinutes: oldestQueuedOverall,
      warningMinutes: 10,
      errorMinutes: 30,
      warningQueued: 15,
      errorQueued: 60,
      disabledReason: queueDisabledReason,
    }),
    buildQueueService({
      service: 'RetailCRM Delta Queue',
      cursor: retailcrmCursor || 'Never',
      lastRun: stateMap.get('retailcrm_orders_queue_last_success_at')?.updated_at || stateMap.get('retailcrm_orders_sync')?.updated_at || null,
      queued: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'queued'),
      processing: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'processing'),
      deadLetter: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'dead_letter'),
      oldestQueuedMinutes: oldestQueuedMinutes(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert']),
      warningMinutes: 5,
      errorMinutes: 15,
      warningQueued: 8,
      errorQueued: 25,
      disabledReason: queueDisabledReason,
    }),
    buildQueueService({
      service: 'RetailCRM History Queue',
      cursor: retailcrmHistoryCursor || 'Never',
      lastRun: stateMap.get('retailcrm_history_queue_last_success_at')?.updated_at || stateMap.get('retailcrm_history_sync')?.updated_at || null,
      queued: countJobs(rows, ['retailcrm_history_delta_pull'], 'queued'),
      processing: countJobs(rows, ['retailcrm_history_delta_pull'], 'processing'),
      deadLetter: countJobs(rows, ['retailcrm_history_delta_pull'], 'dead_letter'),
      oldestQueuedMinutes: oldestQueuedMinutes(rows, ['retailcrm_history_delta_pull']),
      warningMinutes: 10,
      errorMinutes: 30,
      warningQueued: 4,
      errorQueued: 12,
      disabledReason: queueDisabledReason,
    }),
    buildQueueService({
      service: 'Transcription Queue',
      cursor: 'call_transcription',
      lastRun: null,
      queued: countJobs(rows, ['call_transcription'], 'queued'),
      processing: countJobs(rows, ['call_transcription'], 'processing'),
      deadLetter: countJobs(rows, ['call_transcription'], 'dead_letter'),
      oldestQueuedMinutes: transcriptionOldest,
      warningMinutes: 5,
      errorMinutes: 20,
      warningQueued: 8,
      errorQueued: 20,
      disabledReason: queueDisabledReason,
    }),
    buildQueueService({
      service: 'Score Refresh Queue',
      cursor: 'order_score_refresh',
      lastRun: null,
      queued: countJobs(rows, ['order_score_refresh'], 'queued'),
      processing: countJobs(rows, ['order_score_refresh'], 'processing'),
      deadLetter: countJobs(rows, ['order_score_refresh'], 'dead_letter'),
      oldestQueuedMinutes: scoreOldest,
      warningMinutes: 5,
      errorMinutes: 15,
      warningQueued: 10,
      errorQueued: 25,
      disabledReason: queueDisabledReason,
    }),
    buildQueueService({
      service: 'Insight Refresh Queue',
      cursor: 'order_insight_refresh',
      lastRun: null,
      queued: countJobs(rows, ['order_insight_refresh'], 'queued'),
      processing: countJobs(rows, ['order_insight_refresh'], 'processing'),
      deadLetter: countJobs(rows, ['order_insight_refresh'], 'dead_letter'),
      oldestQueuedMinutes: insightOldest,
      warningMinutes: 10,
      errorMinutes: 30,
      warningQueued: 6,
      errorQueued: 15,
      disabledReason: queueDisabledReason,
    }),
  ];

  return {
    enabled,
    queueAvailable,
    summary: {
      queuedTotal,
      processingTotal,
      deadLetterTotal,
      oldestQueuedMinutes: oldestQueuedOverall,
    },
    metrics: {
      retailcrmCursorLagSeconds: secondsSince(retailcrmCursor),
      retailcrmHistoryCursorLagSeconds: secondsSince(retailcrmHistoryCursor),
      transcriptionQueueOldestSeconds: transcriptionOldest === null ? null : transcriptionOldest * 60,
      scoreQueueOldestSeconds: scoreOldest === null ? null : scoreOldest * 60,
      insightQueueOldestSeconds: insightOldest === null ? null : insightOldest * 60,
    },
    services,
  };
}