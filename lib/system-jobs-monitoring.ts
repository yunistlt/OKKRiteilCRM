import { supabase } from '@/utils/supabase';
import { classifySystemJobRetryKind, type SystemJobRetryKind, type SystemJobType } from '@/lib/system-jobs';

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

interface LatencyDistribution {
  p50Seconds: number | null;
  p95Seconds: number | null;
  sampleSize: number;
}

interface RecoveryMetrics {
  completedLast24h: number;
  retryAttemptsLast24h: number;
  retriedJobsLast24h: number;
  deadLettersLast24h: number;
  retryBacklogByKind: Record<SystemJobRetryKind, number>;
}

interface QueueStageSnapshot {
  service: string;
  status: MonitorStatus;
  queued: number;
  processing: number;
  processingLimit: number | null;
  deadLetter: number;
  oldestQueuedSeconds: number | null;
  lastErrorSnippet: string | null;
  lastErrorAt: string | null;
}

interface DominantRetryCauseSummary {
  kind: SystemJobRetryKind;
  count: number;
}

interface PipelineHotspotSummary {
  queue: QueueStageSnapshot | null;
  dominantRetryCause: DominantRetryCauseSummary | null;
  operatorMessage: string | null;
}

function truncateSnippet(message?: string | null, maxLength: number = 180) {
  const value = String(message || '').trim();
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

export interface RealtimePipelineMonitoringSnapshot {
  enabled: boolean;
  queueAvailable: boolean;
  summary: QueueSummary;
  hotspotSummary: PipelineHotspotSummary;
  metrics: {
    retailcrmCursorLagSeconds: number | null;
    retailcrmHistoryCursorLagSeconds: number | null;
    transcriptionQueueOldestSeconds: number | null;
    semanticRulesQueueOldestSeconds: number | null;
    managerAggregateQueueOldestSeconds: number | null;
    scoreQueueOldestSeconds: number | null;
    insightQueueOldestSeconds: number | null;
    recordingReadyToTranscriptLatency: LatencyDistribution;
    orderEventToScoreLatency: LatencyDistribution;
    transcriptionLatency: LatencyDistribution;
    semanticRulesLatency: LatencyDistribution;
    scoreRefreshLatency: LatencyDistribution;
    managerAggregateLatency: LatencyDistribution;
    scoreToAggregateLatency: LatencyDistribution;
    callMatchToAggregateLatency: LatencyDistribution;
    recovery: RecoveryMetrics;
  };
  queueStages: {
    retailcrmDelta: QueueStageSnapshot;
    retailcrmHistory: QueueStageSnapshot;
    callMatch: QueueStageSnapshot;
    transcription: QueueStageSnapshot;
    semanticRules: QueueStageSnapshot;
    scoreRefresh: QueueStageSnapshot;
    managerAggregate: QueueStageSnapshot;
    insightRefresh: QueueStageSnapshot;
  };
  services: MonitorServiceStatus[];
}

type JobRow = {
  job_type: string;
  status: string;
  attempts: number | null;
  error_message: string | null;
  queued_at: string | null;
  available_at: string | null;
  started_at: string | null;
  lock_expires_at: string | null;
};

type CompletedJobRow = {
  id: number;
  job_type: string;
  status: string;
  attempts: number | null;
  payload: Record<string, any> | null;
  queued_at: string | null;
  finished_at: string | null;
  parent_job_id: number | null;
  updated_at: string | null;
};

const MONITORED_JOB_TYPES = [
  'retailcrm_order_delta_pull',
  'retailcrm_history_delta_pull',
  'retailcrm_order_upsert',
  'call_match',
  'call_transcription',
  'call_semantic_rules',
  'manager_aggregate_refresh',
  'order_score_refresh',
  'order_insight_refresh',
] as const;

const LATENCY_JOB_TYPES = [
  'call_transcription',
  'call_semantic_rules',
  'order_score_refresh',
  'manager_aggregate_refresh',
] as const;

const ACTIVITY_JOB_TYPES = [
  ...MONITORED_JOB_TYPES,
  'nightly_reconciliation',
] as const;

const MONITORED_WORKER_KEYS = [
  'system_jobs.watchdog',
  'system_jobs.retailcrm_order_delta',
  'system_jobs.retailcrm_history_delta',
  'system_jobs.call_match',
  'system_jobs.transcription',
  'system_jobs.call_semantic_rules',
  'system_jobs.manager_aggregate_refresh',
  'system_jobs.nightly_reconciliation',
  'system_jobs.score_refresh',
  'system_jobs.order_insight_refresh',
] as const;

type WorkerStateMap = Map<string, { value: string; updated_at: string }>;

const QUEUE_PROCESSING_LIMITS: Partial<Record<SystemJobType, number>> = {
  retailcrm_order_delta_pull: 1,
  retailcrm_history_delta_pull: 1,
  call_match: 1,
  call_transcription: 2,
  order_insight_refresh: 1,
  order_score_refresh: 2,
  manager_aggregate_refresh: 1,
};

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

function getLatestTimestamp(dateA?: string | null, dateB?: string | null) {
  if (!dateA) return dateB || null;
  if (!dateB) return dateA || null;
  return new Date(dateA).getTime() >= new Date(dateB).getTime() ? dateA : dateB;
}

function secondsBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}

function percentile(values: number[], target: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(target * sorted.length) - 1));
  return sorted[index];
}

function buildLatencyDistribution(values: number[]): LatencyDistribution {
  return {
    p50Seconds: percentile(values, 0.5),
    p95Seconds: percentile(values, 0.95),
    sampleSize: values.length,
  };
}

function buildRecoveryMetrics(rows: CompletedJobRow[]): RecoveryMetrics {
  const completedRows = rows.filter((row) => row.status === 'completed');
  const retriedRows = rows.filter((row) => (row.attempts || 0) > 1);

  return {
    completedLast24h: completedRows.length,
    retryAttemptsLast24h: retriedRows.reduce((sum, row) => sum + Math.max((row.attempts || 1) - 1, 0), 0),
    retriedJobsLast24h: retriedRows.length,
    deadLettersLast24h: rows.filter((row) => row.status === 'dead_letter').length,
    retryBacklogByKind: {
      dependency_wait: 0,
      rate_limit: 0,
      network: 0,
      ai: 0,
      generic: 0,
    },
  };
}

function buildRetryBacklogByKind(rows: JobRow[]): Record<SystemJobRetryKind, number> {
  const breakdown: Record<SystemJobRetryKind, number> = {
    dependency_wait: 0,
    rate_limit: 0,
    network: 0,
    ai: 0,
    generic: 0,
  };

  rows
    .filter((row) => (row.attempts || 0) > 1 || row.status === 'dead_letter' || Boolean(row.error_message))
    .forEach((row) => {
      const retryKind = classifySystemJobRetryKind(row.error_message);
      breakdown[retryKind] += 1;
    });

  return breakdown;
}

function getDominantRetryCauseSummary(retryBacklogByKind: Record<SystemJobRetryKind, number>): DominantRetryCauseSummary | null {
  const entries = Object.entries(retryBacklogByKind)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);

  if (!entries.length) return null;

  return {
    kind: entries[0][0] as SystemJobRetryKind,
    count: entries[0][1],
  };
}

function getQueueHotspotSummary(queueStages: QueueStageSnapshot[]): QueueStageSnapshot | null {
  const candidates = queueStages
    .filter((queue) => queue.deadLetter > 0 || queue.queued > 0 || (queue.oldestQueuedSeconds || 0) > 0 || queue.status !== 'ok')
    .sort((left, right) => {
      if (right.deadLetter !== left.deadLetter) return right.deadLetter - left.deadLetter;
      const rightOldest = right.oldestQueuedSeconds || 0;
      const leftOldest = left.oldestQueuedSeconds || 0;
      if (rightOldest !== leftOldest) return rightOldest - leftOldest;
      if (right.queued !== left.queued) return right.queued - left.queued;
      return right.processing - left.processing;
    });

  return candidates[0] || null;
}

function inferHotspotDependencyHint(
  queue: QueueStageSnapshot | null,
  dominantRetryCause: DominantRetryCauseSummary | null
) {
  if (!queue && !dominantRetryCause) return null;

  const service = queue?.service || '';
  const retryKind = dominantRetryCause?.kind || null;

  if (service.includes('RetailCRM')) {
    if (retryKind === 'rate_limit') return 'вероятно упирается в rate limit RetailCRM API';
    if (retryKind === 'network') return 'вероятно деградирует доступ к RetailCRM API';
    return 'проверьте RetailCRM delta/history sync и cursor lag';
  }

  if (service.includes('Transcription')) {
    if (retryKind === 'ai') return 'вероятно узкое место в OpenAI transcription pipeline';
    if (retryKind === 'network') return 'вероятно проблема в скачивании записи или сетевом доступе к AI';
    if (retryKind === 'dependency_wait') return 'записи ещё не готовы или webhook/fallback приходит раньше готовности media';
    return 'проверьте ready_for_transcription backlog и доступность записи';
  }

  if (service.includes('Semantic Rules') || service.includes('Insight')) {
    if (retryKind === 'ai') return 'вероятно деградация OpenAI на аналитическом этапе';
    if (retryKind === 'dependency_wait') return 'аналитика ждёт готовые transcript или upstream score data';
    return 'проверьте AI latency и upstream transcript readiness';
  }

  if (service.includes('Score Refresh')) {
    if (retryKind === 'dependency_wait') return 'score refresh ждёт upstream события из transcript/rules/history';
    if (retryKind === 'ai') return 'часть score pipeline деградирует на AI enrichment';
    return 'проверьте upstream order events, rules и coalescing backlog';
  }

  if (service.includes('Manager Aggregate')) {
    return 'проверьте backlog score refresh и downstream aggregate worker';
  }

  if (service.includes('Call Match')) {
    return 'проверьте свежесть orders/raw_telphin_calls и matching backlog';
  }

  if (retryKind === 'rate_limit') return 'вероятно упирается во внешний API rate limit';
  if (retryKind === 'network') return 'вероятно деградация внешней сети или API';
  if (retryKind === 'ai') return 'вероятно деградация AI dependency';
  if (retryKind === 'dependency_wait') return 'очередь ждёт upstream данные или готовность зависимостей';

  return null;
}

function formatHotspotOperatorMessage(
  queue: QueueStageSnapshot | null,
  dominantRetryCause: DominantRetryCauseSummary | null
) {
  if (!queue && !dominantRetryCause) return null;

  const parts: string[] = [];

  if (queue) {
    const queueParts = [`queued ${queue.queued}`];
    if (queue.processing > 0) queueParts.push(`processing ${queue.processing}`);
    if (queue.deadLetter > 0) queueParts.push(`dead-letter ${queue.deadLetter}`);
    if (queue.oldestQueuedSeconds !== null) queueParts.push(`oldest ${Math.floor(queue.oldestQueuedSeconds / 60)} мин`);
    parts.push(`hotspot ${queue.service}: ${queueParts.join(', ')}`);
  }

  if (dominantRetryCause) {
    parts.push(`dominant retry ${dominantRetryCause.kind}: ${dominantRetryCause.count}`);
  }

  const dependencyHint = inferHotspotDependencyHint(queue, dominantRetryCause);
  if (dependencyHint) {
    parts.push(`likely dependency: ${dependencyHint}`);
  }

  if (queue?.lastErrorSnippet) {
    parts.push(`last error: ${queue.lastErrorSnippet}`);
  }

  return parts.join('; ');
}

function jobLeadTimes(rows: CompletedJobRow[], jobType: string) {
  return rows
    .filter((row) => row.job_type === jobType && row.status === 'completed')
    .map((row) => secondsBetween(row.queued_at, row.finished_at))
    .filter((value): value is number => value !== null);
}

function normalizePayload(payload: Record<string, any> | null | undefined) {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }
  return typeof payload === 'object' ? payload : {};
}

function extractPayloadTimestamp(payload: Record<string, any> | null | undefined, keys: string[]) {
  const normalizedPayload = normalizePayload(payload);

  for (const key of keys) {
    const value = normalizedPayload[key];
    if (!value || typeof value !== 'string') continue;

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

function leadTimesFromDomainEvent(
  rows: CompletedJobRow[],
  jobType: string,
  payloadKeys: string[],
  fallbackKey: 'queued_at' | 'updated_at' = 'queued_at'
) {
  return rows
    .filter((row) => row.job_type === jobType && row.status === 'completed')
    .map((row) => {
      const domainEventAt = extractPayloadTimestamp(row.payload, payloadKeys) || row[fallbackKey] || null;
      return secondsBetween(domainEventAt, row.finished_at);
    })
    .filter((value): value is number => value !== null);
}

function scoreToAggregateLeadTimes(rows: CompletedJobRow[]) {
  const scoreJobs = new Map<number, CompletedJobRow>();
  rows
    .filter((row) => row.job_type === 'order_score_refresh' && row.status === 'completed')
    .forEach((row) => scoreJobs.set(row.id, row));

  return rows
    .filter((row) => row.job_type === 'manager_aggregate_refresh' && row.status === 'completed' && !!row.parent_job_id)
    .map((row) => {
      const parent = row.parent_job_id ? scoreJobs.get(row.parent_job_id) : null;
      return secondsBetween(parent?.queued_at || null, row.finished_at);
    })
    .filter((value): value is number => value !== null);
}

function callMatchToAggregateLeadTimes(rows: CompletedJobRow[]) {
  const scoreJobs = new Map<number, CompletedJobRow>();
  const callMatchJobs = new Map<number, CompletedJobRow>();

  rows
    .filter((row) => row.job_type === 'order_score_refresh' && row.status === 'completed')
    .forEach((row) => scoreJobs.set(row.id, row));

  rows
    .filter((row) => row.job_type === 'call_match' && row.status === 'completed')
    .forEach((row) => callMatchJobs.set(row.id, row));

  return rows
    .filter((row) => row.job_type === 'manager_aggregate_refresh' && row.status === 'completed' && !!row.parent_job_id)
    .map((row) => {
      const scoreJob = row.parent_job_id ? scoreJobs.get(row.parent_job_id) : null;
      const callMatchJob = scoreJob?.parent_job_id ? callMatchJobs.get(scoreJob.parent_job_id) : null;
      return secondsBetween(callMatchJob?.queued_at || null, row.finished_at);
    })
    .filter((value): value is number => value !== null);
}

function getWorkerState(stateMap: WorkerStateMap, workerKey?: string | null) {
  if (!workerKey) {
    return {
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: '',
      lastSuccessMeta: null,
    };
  }

  return {
    lastSuccessAt: stateMap.get(`${workerKey}.last_success_at`)?.value || null,
    lastErrorAt: stateMap.get(`${workerKey}.last_error_at`)?.value || null,
    lastError: stateMap.get(`${workerKey}.last_error`)?.value || '',
    lastSuccessMeta: stateMap.get(`${workerKey}.last_success_meta`)?.value || null,
  };
}

function buildQueueService(params: {
  service: string;
  cursor?: string | null;
  lastRun?: string | null;
  queued: number;
  processing: number;
  processingLimit?: number | null;
  deadLetter?: number;
  oldestQueuedMinutes?: number | null;
  warningMinutes?: number;
  errorMinutes?: number;
  warningQueued?: number;
  errorQueued?: number;
  disabledReason?: string | null;
  workerKey?: string | null;
  stateMap: WorkerStateMap;
}): MonitorServiceStatus {
  const workerState = getWorkerState(params.stateMap, params.workerKey);

  if (params.disabledReason) {
    return {
      service: params.service,
      cursor: params.cursor || 'Disabled',
      last_run: getLatestTimestamp(params.lastRun || null, workerState.lastSuccessAt),
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
  const effectiveLastRun = getLatestTimestamp(params.lastRun || null, workerState.lastSuccessAt);

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

  if (workerState.lastError && workerState.lastErrorAt) {
    const errorIsNewerThanSuccess = !workerState.lastSuccessAt || new Date(workerState.lastErrorAt).getTime() >= new Date(workerState.lastSuccessAt).getTime();
    if (errorIsNewerThanSuccess) {
      status = 'error';
      reason = `Последняя ошибка: ${workerState.lastError}`;
    }
  }

  return {
    service: params.service,
    cursor: params.cursor || 'System Jobs',
    last_run: effectiveLastRun,
    status,
    details: `queued ${params.queued}, processing ${params.processing}${params.processingLimit ? `/${params.processingLimit}` : ''}, oldest ${formatAge(oldestMinutes)}`,
    reason,
  };
}

function buildWorkerService(params: {
  service: string;
  cursor?: string | null;
  lastRun?: string | null;
  warningMinutes?: number;
  errorMinutes?: number;
  disabledReason?: string | null;
  workerKey?: string | null;
  stateMap: WorkerStateMap;
}): MonitorServiceStatus {
  const workerState = getWorkerState(params.stateMap, params.workerKey);
  const effectiveLastRun = getLatestTimestamp(params.lastRun || null, workerState.lastSuccessAt);

  if (params.disabledReason) {
    return {
      service: params.service,
      cursor: params.cursor || 'Disabled',
      last_run: effectiveLastRun,
      status: 'warning',
      details: 'Disabled',
      reason: params.disabledReason,
    };
  }

  const warningMinutes = params.warningMinutes ?? 24 * 60;
  const errorMinutes = params.errorMinutes ?? 36 * 60;
  const ageMinutes = minutesSince(effectiveLastRun);

  let status: MonitorStatus = 'ok';
  let reason: string | null = null;

  if (!effectiveLastRun) {
    status = 'warning';
    reason = 'Ещё не выполнялся';
  } else if (ageMinutes !== null && ageMinutes >= errorMinutes) {
    status = 'error';
    reason = `Давно не выполнялся: ${formatAge(ageMinutes)}`;
  } else if (ageMinutes !== null && ageMinutes >= warningMinutes) {
    status = 'warning';
    reason = `Нужен контроль: ${formatAge(ageMinutes)} с последнего запуска`;
  }

  if (workerState.lastError && workerState.lastErrorAt) {
    const errorIsNewerThanSuccess = !workerState.lastSuccessAt || new Date(workerState.lastErrorAt).getTime() >= new Date(workerState.lastSuccessAt).getTime();
    if (errorIsNewerThanSuccess) {
      status = 'error';
      reason = `Последняя ошибка: ${workerState.lastError}`;
    }
  }

  return {
    service: params.service,
    cursor: params.cursor || 'Worker',
    last_run: effectiveLastRun,
    status,
    details: effectiveLastRun ? `last success ${formatAge(ageMinutes)} ago` : 'no successful runs yet',
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
      ...MONITORED_WORKER_KEYS.flatMap((workerKey) => ([
        `${workerKey}.last_success_at`,
        `${workerKey}.last_error_at`,
        `${workerKey}.last_error`,
        `${workerKey}.last_success_meta`,
      ])),
    ]);

  if (syncError) {
    throw syncError;
  }

  const stateMap = new Map<string, { value: string; updated_at: string }>();
  (syncStates || []).forEach((state: any) => stateMap.set(state.key, state));

  let rows: JobRow[] = [];
  let queueAvailable = true;
  let completedRows: CompletedJobRow[] = [];

  try {
    const { data, error } = await supabase
      .from('system_jobs')
      .select('job_type, status, attempts, error_message, queued_at, available_at, started_at, lock_expires_at')
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

  if (queueAvailable) {
    const completedWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('system_jobs')
      .select('id, job_type, status, attempts, payload, queued_at, finished_at, parent_job_id, updated_at')
      .in('job_type', [...ACTIVITY_JOB_TYPES])
      .in('status', ['completed', 'dead_letter'])
      .gte('updated_at', completedWindowStart)
      .order('updated_at', { ascending: false })
      .limit(1000);

    if (error) {
      throw error;
    }

    completedRows = (data || []) as CompletedJobRow[];
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
  const semanticRulesOldest = oldestQueuedMinutes(rows, ['call_semantic_rules']);
  const managerAggregateOldest = oldestQueuedMinutes(rows, ['manager_aggregate_refresh']);
  const scoreOldest = oldestQueuedMinutes(rows, ['order_score_refresh']);
  const insightOldest = oldestQueuedMinutes(rows, ['order_insight_refresh']);
  const recordingReadyToTranscriptLatency = buildLatencyDistribution(
    leadTimesFromDomainEvent(completedRows, 'call_transcription', ['recording_ready_at'])
  );
  const orderEventToScoreLatency = buildLatencyDistribution(
    leadTimesFromDomainEvent(completedRows, 'order_score_refresh', [
      'order_updated_at',
      'history_occurred_at',
      'call_matched_at',
      'transcript_completed_at',
      'semantic_rules_completed_at',
    ])
  );
  const transcriptionLatency = buildLatencyDistribution(jobLeadTimes(completedRows, 'call_transcription'));
  const semanticRulesLatency = buildLatencyDistribution(jobLeadTimes(completedRows, 'call_semantic_rules'));
  const scoreRefreshLatency = buildLatencyDistribution(jobLeadTimes(completedRows, 'order_score_refresh'));
  const managerAggregateLatency = buildLatencyDistribution(jobLeadTimes(completedRows, 'manager_aggregate_refresh'));
  const scoreToAggregateLatency = buildLatencyDistribution(scoreToAggregateLeadTimes(completedRows));
  const callMatchToAggregateLatency = buildLatencyDistribution(callMatchToAggregateLeadTimes(completedRows));
  const recovery = buildRecoveryMetrics(completedRows);
  recovery.retryBacklogByKind = buildRetryBacklogByKind(rows);

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
      workerKey: 'system_jobs.watchdog',
      stateMap,
    }),
    buildQueueService({
      service: 'RetailCRM Delta Queue',
      cursor: retailcrmCursor || 'Never',
      lastRun: stateMap.get('retailcrm_orders_queue_last_success_at')?.updated_at || stateMap.get('retailcrm_orders_sync')?.updated_at || null,
      queued: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'queued'),
      processing: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.retailcrm_order_delta_pull || null,
      deadLetter: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'dead_letter'),
      oldestQueuedMinutes: oldestQueuedMinutes(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert']),
      warningMinutes: 5,
      errorMinutes: 15,
      warningQueued: 8,
      errorQueued: 25,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.retailcrm_order_delta',
      stateMap,
    }),
    buildQueueService({
      service: 'RetailCRM History Queue',
      cursor: retailcrmHistoryCursor || 'Never',
      lastRun: stateMap.get('retailcrm_history_queue_last_success_at')?.updated_at || stateMap.get('retailcrm_history_sync')?.updated_at || null,
      queued: countJobs(rows, ['retailcrm_history_delta_pull'], 'queued'),
      processing: countJobs(rows, ['retailcrm_history_delta_pull'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.retailcrm_history_delta_pull || null,
      deadLetter: countJobs(rows, ['retailcrm_history_delta_pull'], 'dead_letter'),
      oldestQueuedMinutes: oldestQueuedMinutes(rows, ['retailcrm_history_delta_pull']),
      warningMinutes: 10,
      errorMinutes: 30,
      warningQueued: 4,
      errorQueued: 12,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.retailcrm_history_delta',
      stateMap,
    }),
    buildQueueService({
      service: 'Call Match Queue',
      cursor: 'call_match',
      lastRun: null,
      queued: countJobs(rows, ['call_match'], 'queued'),
      processing: countJobs(rows, ['call_match'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.call_match || null,
      deadLetter: countJobs(rows, ['call_match'], 'dead_letter'),
      oldestQueuedMinutes: oldestQueuedMinutes(rows, ['call_match']),
      warningMinutes: 5,
      errorMinutes: 15,
      warningQueued: 8,
      errorQueued: 20,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.call_match',
      stateMap,
    }),
    buildQueueService({
      service: 'Transcription Queue',
      cursor: 'call_transcription',
      lastRun: null,
      queued: countJobs(rows, ['call_transcription'], 'queued'),
      processing: countJobs(rows, ['call_transcription'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.call_transcription || null,
      deadLetter: countJobs(rows, ['call_transcription'], 'dead_letter'),
      oldestQueuedMinutes: transcriptionOldest,
      warningMinutes: 5,
      errorMinutes: 20,
      warningQueued: 8,
      errorQueued: 20,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.transcription',
      stateMap,
    }),
    buildQueueService({
      service: 'Semantic Rules Queue',
      cursor: 'call_semantic_rules',
      lastRun: null,
      queued: countJobs(rows, ['call_semantic_rules'], 'queued'),
      processing: countJobs(rows, ['call_semantic_rules'], 'processing'),
      processingLimit: null,
      deadLetter: countJobs(rows, ['call_semantic_rules'], 'dead_letter'),
      oldestQueuedMinutes: semanticRulesOldest,
      warningMinutes: 5,
      errorMinutes: 20,
      warningQueued: 8,
      errorQueued: 20,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.call_semantic_rules',
      stateMap,
    }),
    buildQueueService({
      service: 'Manager Aggregate Queue',
      cursor: 'manager_aggregate_refresh',
      lastRun: null,
      queued: countJobs(rows, ['manager_aggregate_refresh'], 'queued'),
      processing: countJobs(rows, ['manager_aggregate_refresh'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.manager_aggregate_refresh || null,
      deadLetter: countJobs(rows, ['manager_aggregate_refresh'], 'dead_letter'),
      oldestQueuedMinutes: managerAggregateOldest,
      warningMinutes: 10,
      errorMinutes: 30,
      warningQueued: 6,
      errorQueued: 15,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.manager_aggregate_refresh',
      stateMap,
    }),
    buildQueueService({
      service: 'Score Refresh Queue',
      cursor: 'order_score_refresh',
      lastRun: null,
      queued: countJobs(rows, ['order_score_refresh'], 'queued'),
      processing: countJobs(rows, ['order_score_refresh'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.order_score_refresh || null,
      deadLetter: countJobs(rows, ['order_score_refresh'], 'dead_letter'),
      oldestQueuedMinutes: scoreOldest,
      warningMinutes: 5,
      errorMinutes: 15,
      warningQueued: 10,
      errorQueued: 25,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.score_refresh',
      stateMap,
    }),
    buildQueueService({
      service: 'Insight Refresh Queue',
      cursor: 'order_insight_refresh',
      lastRun: null,
      queued: countJobs(rows, ['order_insight_refresh'], 'queued'),
      processing: countJobs(rows, ['order_insight_refresh'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.order_insight_refresh || null,
      deadLetter: countJobs(rows, ['order_insight_refresh'], 'dead_letter'),
      oldestQueuedMinutes: insightOldest,
      warningMinutes: 10,
      errorMinutes: 30,
      warningQueued: 6,
      errorQueued: 15,
      disabledReason: queueDisabledReason,
      workerKey: 'system_jobs.order_insight_refresh',
      stateMap,
    }),
    buildWorkerService({
      service: 'Nightly Reconciliation',
      cursor: 'Daily fallback rebuild',
      lastRun: null,
      warningMinutes: 24 * 60,
      errorMinutes: 36 * 60,
      workerKey: 'system_jobs.nightly_reconciliation',
      stateMap,
    }),
  ];

  const serviceMap = new Map(services.map((service) => [service.service, service]));
  const transcriptionWorkerState = getWorkerState(stateMap, 'system_jobs.transcription');
  const semanticRulesWorkerState = getWorkerState(stateMap, 'system_jobs.call_semantic_rules');
  const scoreWorkerState = getWorkerState(stateMap, 'system_jobs.score_refresh');
  const aggregateWorkerState = getWorkerState(stateMap, 'system_jobs.manager_aggregate_refresh');
  const insightWorkerState = getWorkerState(stateMap, 'system_jobs.order_insight_refresh');
  const callMatchWorkerState = getWorkerState(stateMap, 'system_jobs.call_match');
  const retailcrmDeltaWorkerState = getWorkerState(stateMap, 'system_jobs.retailcrm_order_delta');
  const retailcrmHistoryWorkerState = getWorkerState(stateMap, 'system_jobs.retailcrm_history_delta');

  const queueStages = {
    retailcrmDelta: {
      service: 'RetailCRM Delta Queue',
      status: serviceMap.get('RetailCRM Delta Queue')?.status || 'warning',
      queued: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'queued'),
      processing: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.retailcrm_order_delta_pull || null,
      deadLetter: countJobs(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'], 'dead_letter'),
      oldestQueuedSeconds: oldestQueuedMinutes(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert']) === null
        ? null
        : oldestQueuedMinutes(rows, ['retailcrm_order_delta_pull', 'retailcrm_order_upsert'])! * 60,
      lastErrorSnippet: truncateSnippet(retailcrmDeltaWorkerState.lastError),
      lastErrorAt: retailcrmDeltaWorkerState.lastErrorAt,
    },
    retailcrmHistory: {
      service: 'RetailCRM History Queue',
      status: serviceMap.get('RetailCRM History Queue')?.status || 'warning',
      queued: countJobs(rows, ['retailcrm_history_delta_pull'], 'queued'),
      processing: countJobs(rows, ['retailcrm_history_delta_pull'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.retailcrm_history_delta_pull || null,
      deadLetter: countJobs(rows, ['retailcrm_history_delta_pull'], 'dead_letter'),
      oldestQueuedSeconds: oldestQueuedMinutes(rows, ['retailcrm_history_delta_pull']) === null
        ? null
        : oldestQueuedMinutes(rows, ['retailcrm_history_delta_pull'])! * 60,
      lastErrorSnippet: truncateSnippet(retailcrmHistoryWorkerState.lastError),
      lastErrorAt: retailcrmHistoryWorkerState.lastErrorAt,
    },
    callMatch: {
      service: 'Call Match Queue',
      status: serviceMap.get('Call Match Queue')?.status || 'warning',
      queued: countJobs(rows, ['call_match'], 'queued'),
      processing: countJobs(rows, ['call_match'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.call_match || null,
      deadLetter: countJobs(rows, ['call_match'], 'dead_letter'),
      oldestQueuedSeconds: oldestQueuedMinutes(rows, ['call_match']) === null ? null : oldestQueuedMinutes(rows, ['call_match'])! * 60,
      lastErrorSnippet: truncateSnippet(callMatchWorkerState.lastError),
      lastErrorAt: callMatchWorkerState.lastErrorAt,
    },
    transcription: {
      service: 'Transcription Queue',
      status: serviceMap.get('Transcription Queue')?.status || 'warning',
      queued: countJobs(rows, ['call_transcription'], 'queued'),
      processing: countJobs(rows, ['call_transcription'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.call_transcription || null,
      deadLetter: countJobs(rows, ['call_transcription'], 'dead_letter'),
      oldestQueuedSeconds: transcriptionOldest === null ? null : transcriptionOldest * 60,
      lastErrorSnippet: truncateSnippet(transcriptionWorkerState.lastError),
      lastErrorAt: transcriptionWorkerState.lastErrorAt,
    },
    semanticRules: {
      service: 'Semantic Rules Queue',
      status: serviceMap.get('Semantic Rules Queue')?.status || 'warning',
      queued: countJobs(rows, ['call_semantic_rules'], 'queued'),
      processing: countJobs(rows, ['call_semantic_rules'], 'processing'),
      processingLimit: null,
      deadLetter: countJobs(rows, ['call_semantic_rules'], 'dead_letter'),
      oldestQueuedSeconds: semanticRulesOldest === null ? null : semanticRulesOldest * 60,
      lastErrorSnippet: truncateSnippet(semanticRulesWorkerState.lastError),
      lastErrorAt: semanticRulesWorkerState.lastErrorAt,
    },
    scoreRefresh: {
      service: 'Score Refresh Queue',
      status: serviceMap.get('Score Refresh Queue')?.status || 'warning',
      queued: countJobs(rows, ['order_score_refresh'], 'queued'),
      processing: countJobs(rows, ['order_score_refresh'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.order_score_refresh || null,
      deadLetter: countJobs(rows, ['order_score_refresh'], 'dead_letter'),
      oldestQueuedSeconds: scoreOldest === null ? null : scoreOldest * 60,
      lastErrorSnippet: truncateSnippet(scoreWorkerState.lastError),
      lastErrorAt: scoreWorkerState.lastErrorAt,
    },
    managerAggregate: {
      service: 'Manager Aggregate Queue',
      status: serviceMap.get('Manager Aggregate Queue')?.status || 'warning',
      queued: countJobs(rows, ['manager_aggregate_refresh'], 'queued'),
      processing: countJobs(rows, ['manager_aggregate_refresh'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.manager_aggregate_refresh || null,
      deadLetter: countJobs(rows, ['manager_aggregate_refresh'], 'dead_letter'),
      oldestQueuedSeconds: managerAggregateOldest === null ? null : managerAggregateOldest * 60,
      lastErrorSnippet: truncateSnippet(aggregateWorkerState.lastError),
      lastErrorAt: aggregateWorkerState.lastErrorAt,
    },
    insightRefresh: {
      service: 'Insight Refresh Queue',
      status: serviceMap.get('Insight Refresh Queue')?.status || 'warning',
      queued: countJobs(rows, ['order_insight_refresh'], 'queued'),
      processing: countJobs(rows, ['order_insight_refresh'], 'processing'),
      processingLimit: QUEUE_PROCESSING_LIMITS.order_insight_refresh || null,
      deadLetter: countJobs(rows, ['order_insight_refresh'], 'dead_letter'),
      oldestQueuedSeconds: insightOldest === null ? null : insightOldest * 60,
      lastErrorSnippet: truncateSnippet(insightWorkerState.lastError),
      lastErrorAt: insightWorkerState.lastErrorAt,
    },
  };

  const hotspotQueue = getQueueHotspotSummary(Object.values(queueStages));
  const dominantRetryCause = getDominantRetryCauseSummary(recovery.retryBacklogByKind);
  const hotspotSummary: PipelineHotspotSummary = {
    queue: hotspotQueue,
    dominantRetryCause,
    operatorMessage: formatHotspotOperatorMessage(hotspotQueue, dominantRetryCause),
  };

  return {
    enabled,
    queueAvailable,
    summary: {
      queuedTotal,
      processingTotal,
      deadLetterTotal,
      oldestQueuedMinutes: oldestQueuedOverall,
    },
    hotspotSummary,
    metrics: {
      retailcrmCursorLagSeconds: secondsSince(retailcrmCursor),
      retailcrmHistoryCursorLagSeconds: secondsSince(retailcrmHistoryCursor),
      transcriptionQueueOldestSeconds: transcriptionOldest === null ? null : transcriptionOldest * 60,
      semanticRulesQueueOldestSeconds: semanticRulesOldest === null ? null : semanticRulesOldest * 60,
      managerAggregateQueueOldestSeconds: managerAggregateOldest === null ? null : managerAggregateOldest * 60,
      scoreQueueOldestSeconds: scoreOldest === null ? null : scoreOldest * 60,
      insightQueueOldestSeconds: insightOldest === null ? null : insightOldest * 60,
      recordingReadyToTranscriptLatency,
      orderEventToScoreLatency,
      transcriptionLatency,
      semanticRulesLatency,
      scoreRefreshLatency,
      managerAggregateLatency,
      scoreToAggregateLatency,
      callMatchToAggregateLatency,
      recovery,
    },
    queueStages,
    services,
  };
}