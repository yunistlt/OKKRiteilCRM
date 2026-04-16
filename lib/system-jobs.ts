import { supabase } from '@/utils/supabase';

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

export interface EnqueueSystemJobInput {
  jobType: SystemJobType;
  payload?: Record<string, any>;
  priority?: number;
  idempotencyKey?: string;
  maxAttempts?: number;
  availableAt?: string;
  parentJobId?: number | null;
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

export async function claimSystemJobs(params: {
  workerId: string;
  jobTypes?: SystemJobType[];
  limit?: number;
  lockSeconds?: number;
}) {
  const { data, error } = await supabase.rpc('claim_system_jobs', {
    p_worker_id: params.workerId,
    p_job_types: params.jobTypes || null,
    p_limit: params.limit ?? 10,
    p_lock_seconds: params.lockSeconds ?? 300,
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

export async function requeueExpiredSystemJobs() {
  const { data, error } = await supabase.rpc('requeue_expired_system_jobs');

  if (error) throw error;
  return data;
}