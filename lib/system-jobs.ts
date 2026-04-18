import { supabase } from '@/utils/supabase';
import {
  getDefaultRealtimePipelineEnabled,
  isRealtimePipelineEnabled,
} from '@/lib/realtime-pipeline';

export type SystemJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export type SystemJobType =
  | 'retailcrm_order_delta_pull'
  | 'retailcrm_history_delta_pull'
  | 'retailcrm_order_upsert'
  | 'telphin_call_upsert'
  | 'call_match'
  | 'call_transcription'
  | 'call_semantic_rules'
  | 'order_insight_refresh'
  | 'order_score_refresh'
  | 'manager_aggregate_refresh'
  | 'nightly_reconciliation';

export type SystemJobRetryKind = 'dependency_wait' | 'rate_limit' | 'network' | 'ai' | 'generic';

export interface EnqueueSystemJobInput {
  jobType: SystemJobType;
  payload?: Record<string, any>;
  priority?: number;
  idempotencyKey?: string;
  maxAttempts?: number;
  availableAt?: string;
  parentJobId?: number | null;
}

function isMissingRelationError(error: any) {
  return (
    error?.code === '42P01' ||
    error?.message?.includes('system_jobs') ||
    error?.message?.includes('relation')
  );
}

export function isSystemJobsPipelineEnabled() {
  return getDefaultRealtimePipelineEnabled();
}

export async function isSystemJobsPipelineRuntimeEnabled() {
  return isRealtimePipelineEnabled();
}

export async function enqueueSystemJob(input: EnqueueSystemJobInput) {
  const insertPayload = {
    job_type: input.jobType,
    payload: input.payload || {},
    priority: input.priority ?? 100,
    idempotency_key: input.idempotencyKey || null,
    max_attempts: input.maxAttempts ?? 5,
    available_at: input.availableAt || new Date().toISOString(),
    parent_job_id: input.parentJobId ?? null,
  };

  if (input.idempotencyKey) {
    const { data, error } = await supabase
      .from('system_jobs')
      .upsert(insertPayload, { onConflict: 'idempotency_key' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('system_jobs')
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function safeEnqueueSystemJob(input: EnqueueSystemJobInput) {
  if (!(await isSystemJobsPipelineRuntimeEnabled())) {
    return null;
  }

  try {
    return await enqueueSystemJob(input);
  } catch (error: any) {
    if (isMissingRelationError(error)) {
      console.warn('[SystemJobs] system_jobs is not ready yet, skipping enqueue.');
      return null;
    }

    throw error;
  }
}

function buildTimeBucket(windowSeconds: number, now: Date = new Date()) {
  return Math.floor(now.getTime() / (windowSeconds * 1000));
}

function buildOrderRefreshIdempotencyKey(params: {
  jobType: 'order_score_refresh' | 'order_insight_refresh';
  orderId: number | string;
  windowSeconds?: number;
}) {
  const windowSeconds = params.windowSeconds ?? 30;
  const bucket = buildTimeBucket(windowSeconds);
  return `${params.jobType}:${params.orderId}:bucket:${bucket}`;
}

interface EnqueueOrderRefreshJobInput {
  jobType: 'order_score_refresh' | 'order_insight_refresh';
  orderId: number | string;
  source: string;
  priority?: number;
  windowSeconds?: number;
  payload?: Record<string, any>;
  maxAttempts?: number;
  parentJobId?: number | null;
}

function buildOrderRefreshJobInput(input: EnqueueOrderRefreshJobInput): EnqueueSystemJobInput {
  return {
    jobType: input.jobType,
    payload: {
      ...(input.payload || {}),
      order_id: input.orderId,
      source: input.source,
    },
    priority: input.priority ?? 25,
    idempotencyKey: buildOrderRefreshIdempotencyKey({
      jobType: input.jobType,
      orderId: input.orderId,
      windowSeconds: input.windowSeconds,
    }),
    maxAttempts: input.maxAttempts ?? 5,
    parentJobId: input.parentJobId ?? null,
  };
}

export async function enqueueOrderRefreshJob(input: EnqueueOrderRefreshJobInput) {
  return enqueueSystemJob(buildOrderRefreshJobInput(input));
}

export async function safeEnqueueOrderRefreshJob(input: EnqueueOrderRefreshJobInput) {
  return safeEnqueueSystemJob(buildOrderRefreshJobInput(input));
}

interface EnqueueCallSemanticRulesJobInput {
  callId: string;
  source: string;
  priority?: number;
  payload?: Record<string, any>;
  maxAttempts?: number;
  parentJobId?: number | null;
}

function buildCallSemanticRulesJobInput(input: EnqueueCallSemanticRulesJobInput): EnqueueSystemJobInput {
  return {
    jobType: 'call_semantic_rules',
    payload: {
      ...(input.payload || {}),
      telphin_call_id: input.callId,
      source: input.source,
    },
    priority: input.priority ?? 20,
    idempotencyKey: `call_semantic_rules:${input.callId}`,
    maxAttempts: input.maxAttempts ?? 5,
    parentJobId: input.parentJobId ?? null,
  };
}

export async function enqueueCallSemanticRulesJob(input: EnqueueCallSemanticRulesJobInput) {
  return enqueueSystemJob(buildCallSemanticRulesJobInput(input));
}

export async function safeEnqueueCallSemanticRulesJob(input: EnqueueCallSemanticRulesJobInput) {
  return safeEnqueueSystemJob(buildCallSemanticRulesJobInput(input));
}

interface CalculateCallTranscriptionPriorityInput {
  startedAt?: string | null;
  hasWorkingOrderMatch?: boolean;
}

export function calculateCallTranscriptionPriority(input: CalculateCallTranscriptionPriorityInput) {
  const startedAt = input.startedAt ? new Date(input.startedAt) : null;
  const ageMinutes = startedAt ? (Date.now() - startedAt.getTime()) / 60000 : null;

  let priority = 18;

  if (ageMinutes !== null) {
    if (ageMinutes <= 15) priority = 6;
    else if (ageMinutes <= 60) priority = 8;
    else if (ageMinutes <= 6 * 60) priority = 12;
  }

  if (input.hasWorkingOrderMatch) {
    priority = Math.max(1, priority - 4);
  }

  return priority;
}

interface EnqueueCallTranscriptionJobInput {
  callId: string;
  recordingUrl: string;
  source: string;
  startedAt?: string | null;
  hasWorkingOrderMatch?: boolean;
  priority?: number;
  payload?: Record<string, any>;
  maxAttempts?: number;
  parentJobId?: number | null;
}

function buildCallTranscriptionJobInput(input: EnqueueCallTranscriptionJobInput): EnqueueSystemJobInput {
  return {
    jobType: 'call_transcription',
    payload: {
      ...(input.payload || {}),
      telphin_call_id: input.callId,
      source: input.source,
      recording_url: input.recordingUrl,
    },
    priority: input.priority ?? calculateCallTranscriptionPriority({
      startedAt: input.startedAt,
      hasWorkingOrderMatch: input.hasWorkingOrderMatch,
    }),
    idempotencyKey: `call_transcription:${input.callId}`,
    maxAttempts: input.maxAttempts ?? 5,
    parentJobId: input.parentJobId ?? null,
  };
}

export async function enqueueCallTranscriptionJob(input: EnqueueCallTranscriptionJobInput) {
  return enqueueSystemJob(buildCallTranscriptionJobInput(input));
}

export async function safeEnqueueCallTranscriptionJob(input: EnqueueCallTranscriptionJobInput) {
  return safeEnqueueSystemJob(buildCallTranscriptionJobInput(input));
}

function buildManagerAggregateRefreshIdempotencyKey(params: {
  managerId: number | string;
  windowSeconds?: number;
}) {
  const windowSeconds = params.windowSeconds ?? 60;
  const bucket = buildTimeBucket(windowSeconds);
  return `manager_aggregate_refresh:${params.managerId}:bucket:${bucket}`;
}

interface EnqueueManagerAggregateRefreshJobInput {
  managerId: number | string;
  source: string;
  priority?: number;
  windowSeconds?: number;
  payload?: Record<string, any>;
  maxAttempts?: number;
  parentJobId?: number | null;
}

function buildManagerAggregateRefreshJobInput(input: EnqueueManagerAggregateRefreshJobInput): EnqueueSystemJobInput {
  return {
    jobType: 'manager_aggregate_refresh',
    payload: {
      ...(input.payload || {}),
      manager_id: input.managerId,
      source: input.source,
    },
    priority: input.priority ?? 40,
    idempotencyKey: buildManagerAggregateRefreshIdempotencyKey({
      managerId: input.managerId,
      windowSeconds: input.windowSeconds,
    }),
    maxAttempts: input.maxAttempts ?? 5,
    parentJobId: input.parentJobId ?? null,
  };
}

export async function enqueueManagerAggregateRefreshJob(input: EnqueueManagerAggregateRefreshJobInput) {
  return enqueueSystemJob(buildManagerAggregateRefreshJobInput(input));
}

export async function safeEnqueueManagerAggregateRefreshJob(input: EnqueueManagerAggregateRefreshJobInput) {
  return safeEnqueueSystemJob(buildManagerAggregateRefreshJobInput(input));
}

export async function claimSystemJobs(params: {
  workerId: string;
  jobTypes?: SystemJobType[];
  limit?: number;
  lockSeconds?: number;
  maxProcessing?: number | null;
  concurrencyKey?: string | null;
}) {
  const { data, error } = await supabase.rpc('claim_system_jobs', {
    p_worker_id: params.workerId,
    p_job_types: params.jobTypes || null,
    p_limit: params.limit ?? 10,
    p_lock_seconds: params.lockSeconds ?? 300,
    p_max_processing: params.maxProcessing ?? null,
    p_concurrency_key: params.concurrencyKey ?? null,
  });

  if (error) throw error;
  return data || [];
}

export async function completeSystemJob(jobId: number, result?: Record<string, any> | null) {
  const { data, error } = await supabase.rpc('complete_system_job', {
    p_job_id: jobId,
    p_result: result || null,
  });

  if (error) throw error;
  return data;
}

export async function failSystemJob(jobId: number, errorMessage: string, retryDelaySeconds: number = 60) {
  const { data, error } = await supabase.rpc('fail_system_job', {
    p_job_id: jobId,
    p_error: errorMessage,
    p_retry_delay_seconds: retryDelaySeconds,
  });

  if (error) throw error;
  return data;
}

function getBackoffDelay(attempts: number, delays: number[]) {
  const normalizedAttempts = Math.max(1, attempts || 1);
  const index = Math.min(normalizedAttempts - 1, delays.length - 1);
  return delays[index];
}

export function classifySystemJobRetryKind(errorMessage?: string | null): SystemJobRetryKind {
  const lower = String(errorMessage || '').toLowerCase();

  if (
    lower.includes('not ready') ||
    lower.includes('waiting_') ||
    lower.includes('already being transcribed') ||
    lower.includes('try again later')
  ) {
    return 'dependency_wait';
  }

  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return 'rate_limit';
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('5xx') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('500') ||
    lower.includes('upstream') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('socket') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('audio download failed')
  ) {
    return 'network';
  }

  if (
    lower.includes('openai') ||
    lower.includes('whisper') ||
    lower.includes('gpt-') ||
    lower.includes('insight model') ||
    lower.includes('ai ') ||
    lower.includes('ai-')
  ) {
    return 'ai';
  }

  return 'generic';
}

export function getAdaptiveSystemJobRetry(params: {
  attempts: number;
  errorMessage?: string | null;
  profile?: 'fast' | 'slow';
}) {
  const retryKind = classifySystemJobRetryKind(params.errorMessage);
  const profile = params.profile || 'fast';
  const genericDelays = profile === 'slow' ? [60, 180, 600, 1800] : [30, 120, 300, 900];

  const retryDelaySeconds = retryKind === 'dependency_wait'
    ? getBackoffDelay(params.attempts, profile === 'slow' ? [45, 90, 180, 300] : [15, 45, 90, 180])
    : retryKind === 'rate_limit'
      ? getBackoffDelay(params.attempts, profile === 'slow' ? [180, 600, 1800, 3600] : [120, 300, 900, 1800])
      : retryKind === 'network'
        ? getBackoffDelay(params.attempts, profile === 'slow' ? [120, 300, 900, 1800] : [60, 180, 600, 1200])
        : retryKind === 'ai'
          ? getBackoffDelay(params.attempts, profile === 'slow' ? [180, 600, 1800, 3600] : [90, 300, 900, 1800])
          : getBackoffDelay(params.attempts, genericDelays);

  return {
    retryKind,
    retryDelaySeconds,
  };
}

export async function requeueExpiredSystemJobs() {
  const { data, error } = await supabase.rpc('requeue_expired_system_jobs');

  if (error) throw error;
  return data;
}