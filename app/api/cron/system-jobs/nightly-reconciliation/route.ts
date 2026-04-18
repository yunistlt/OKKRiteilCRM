import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueManagerAggregateRefreshJob,
  enqueueOrderRefreshJob,
  enqueueSystemJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
} from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'system_jobs.nightly_reconciliation';
const MANAGER_BATCH_SIZE = 10;
const PRIORITY_BATCH_SIZE = 100;

type NightlyScope = 'all' | 'aggregates' | 'priorities';

function normalizeScope(value: string | null | undefined): NightlyScope {
  if (value === 'aggregates' || value === 'priorities') {
    return value;
  }

  return 'all';
}

function getScopeStateKeys(scope: NightlyScope) {
  const suffix = scope === 'all' ? 'all' : scope;

  return {
    cursorManagerKey: `nightly_reconciliation_${suffix}_manager_offset`,
    cursorPriorityKey: `nightly_reconciliation_${suffix}_priority_offset`,
    statusKey: `nightly_reconciliation_${suffix}_status`,
  };
}

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function getDailySeedKey(scope: NightlyScope, now: Date = new Date()) {
  return `nightly_reconciliation:${scope}:${now.toISOString().slice(0, 10)}`;
}

function getChunkSeedKey(scope: NightlyScope, managerOffset: number, priorityOffset: number) {
  return `nightly_reconciliation:${scope}:${managerOffset}:${priorityOffset}`;
}

function parseNonNegativeInt(value: unknown) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

async function writeNightlyState(params: {
  scope: NightlyScope;
  managerOffset: number;
  priorityOffset: number;
  status: string;
}) {
  const now = new Date().toISOString();
  const stateKeys = getScopeStateKeys(params.scope);
  const { error } = await supabase.from('sync_state').upsert([
    {
      key: stateKeys.cursorManagerKey,
      value: String(params.managerOffset),
      updated_at: now,
    },
    {
      key: stateKeys.cursorPriorityKey,
      value: String(params.priorityOffset),
      updated_at: now,
    },
    {
      key: stateKeys.statusKey,
      value: params.status,
      updated_at: now,
    },
  ], { onConflict: 'key' });

  if (error) {
    throw error;
  }
}

async function getNightlyOffsets(scope: NightlyScope) {
  const stateKeys = getScopeStateKeys(scope);
  const { data, error } = await supabase
    .from('sync_state')
    .select('key, value')
    .in('key', [stateKeys.cursorManagerKey, stateKeys.cursorPriorityKey]);

  if (error) {
    throw error;
  }

  const stateMap = new Map<string, string>();
  (data || []).forEach((row: any) => stateMap.set(row.key, row.value || '0'));

  return {
    managerOffset: parseNonNegativeInt(stateMap.get(stateKeys.cursorManagerKey)),
    priorityOffset: parseNonNegativeInt(stateMap.get(stateKeys.cursorPriorityKey)),
  };
}

async function getControlledManagerIds() {
  const { data, error } = await supabase
    .from('manager_settings')
    .select('id')
    .eq('is_controlled', true)
    .order('id', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []).map((row: any) => Number(row.id)).filter((managerId: number) => Number.isFinite(managerId));
}

async function getWorkingOrderIds(offset: number, limit: number) {
  const { data: workingSettings, error: workingError } = await supabase
    .from('status_settings')
    .select('code')
    .eq('is_working', true);

  if (workingError) {
    throw workingError;
  }

  const workingCodes = (workingSettings || []).map((row: any) => row.code).filter(Boolean);
  if (!workingCodes.length) {
    return [] as number[];
  }

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id')
    .in('status', workingCodes)
    .order('updated_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    throw error;
  }

  return (orders || []).map((row: any) => Number(row.id)).filter((orderId: number) => Number.isFinite(orderId));
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);
    const force = req.nextUrl.searchParams.get('force') === 'true';
    const scope = normalizeScope(req.nextUrl.searchParams.get('scope'));

    if (force) {
      await writeNightlyState({ scope, managerOffset: 0, priorityOffset: 0, status: 'reset_requested' });
    }

    const storedOffsets = force ? { managerOffset: 0, priorityOffset: 0 } : await getNightlyOffsets(scope);
    await enqueueSystemJob({
      jobType: 'nightly_reconciliation',
      payload: {
        scope,
        manager_offset: storedOffsets.managerOffset,
        priority_offset: storedOffsets.priorityOffset,
        source: force ? 'manual_force' : 'scheduled',
      },
      priority: 70,
      idempotencyKey: force ? `nightly_reconciliation:${scope}:force:${Date.now()}` : getDailySeedKey(scope),
      maxAttempts: 5,
    });

    const claimed = await claimSystemJobs({
      workerId: `nightly-reconciliation:${Date.now()}`,
      jobTypes: ['nightly_reconciliation'],
      limit: 1,
      lockSeconds: 240,
      maxProcessing: 1,
      concurrencyKey: 'system_jobs.nightly_reconciliation',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const job = claimed[0];

    try {
      const payload = (job.payload || {}) as {
        scope?: NightlyScope;
        manager_offset?: number;
        priority_offset?: number;
      };
      const jobScope = normalizeScope(payload.scope);
      const managerOffset = parseNonNegativeInt(payload.manager_offset);
      const priorityOffset = parseNonNegativeInt(payload.priority_offset);
      await writeNightlyState({ scope: jobScope, managerOffset, priorityOffset, status: 'running' });

      const shouldSeedAggregates = jobScope === 'all' || jobScope === 'aggregates';
      const shouldSeedPriorities = jobScope === 'all' || jobScope === 'priorities';

      const controlledManagerIds = shouldSeedAggregates ? await getControlledManagerIds() : [];
      const managerBatch = shouldSeedAggregates
        ? controlledManagerIds.slice(managerOffset, managerOffset + MANAGER_BATCH_SIZE)
        : [];
      for (const managerId of managerBatch) {
        await enqueueManagerAggregateRefreshJob({
          managerId,
          source: 'nightly_reconciliation',
          priority: 50,
          windowSeconds: 1,
          payload: {
            reconciliation: true,
            seeded_by: WORKER_KEY,
            scope: jobScope,
          },
          parentJobId: job.id,
        });
      }

      const priorityBatch = shouldSeedPriorities
        ? await getWorkingOrderIds(priorityOffset, PRIORITY_BATCH_SIZE)
        : [];
      for (const orderId of priorityBatch) {
        await enqueueOrderRefreshJob({
          jobType: 'order_score_refresh',
          orderId,
          source: 'nightly_reconciliation',
          priority: 30,
          windowSeconds: 1,
          payload: {
            reconciliation: true,
            seeded_by: WORKER_KEY,
            scope: jobScope,
          },
          parentJobId: job.id,
        });
      }

      const nextManagerOffset = managerOffset + managerBatch.length;
      const nextPriorityOffset = priorityOffset + priorityBatch.length;
      const hasMoreManagers = shouldSeedAggregates && nextManagerOffset < controlledManagerIds.length;
      const hasMorePriorities = shouldSeedPriorities && priorityBatch.length === PRIORITY_BATCH_SIZE;

      if (hasMoreManagers || hasMorePriorities) {
        await writeNightlyState({
          scope: jobScope,
          managerOffset: nextManagerOffset,
          priorityOffset: nextPriorityOffset,
          status: 'chunked_running',
        });

        await enqueueSystemJob({
          jobType: 'nightly_reconciliation',
          payload: {
            scope: jobScope,
            manager_offset: nextManagerOffset,
            priority_offset: nextPriorityOffset,
            source: 'follow_up',
          },
          priority: 70,
          idempotencyKey: getChunkSeedKey(jobScope, nextManagerOffset, nextPriorityOffset),
          maxAttempts: 5,
          parentJobId: job.id,
        });

        const result = {
          status: 'chunked',
          manager_jobs_seeded: managerBatch.length,
          priority_jobs_seeded: priorityBatch.length,
          scope: jobScope,
          next_manager_offset: nextManagerOffset,
          next_priority_offset: nextPriorityOffset,
          has_more_managers: hasMoreManagers,
          has_more_priorities: hasMorePriorities,
        };

        await completeSystemJob(job.id, result);
        await recordWorkerSuccess(WORKER_KEY, result);

        return NextResponse.json({ ok: true, ...result });
      }

      await writeNightlyState({ scope: jobScope, managerOffset: 0, priorityOffset: 0, status: 'completed' });
      const result = {
        status: 'completed',
        manager_jobs_seeded: managerBatch.length,
        priority_jobs_seeded: priorityBatch.length,
        scope: jobScope,
        next_manager_offset: 0,
        next_priority_offset: 0,
      };

      await completeSystemJob(job.id, result);
      await recordWorkerSuccess(WORKER_KEY, result);

      return NextResponse.json({ ok: true, ...result });
    } catch (error: any) {
      const retry = getAdaptiveSystemJobRetry({
        attempts: job.attempts || 0,
        errorMessage: error.message || 'Unknown nightly reconciliation error',
        profile: 'slow',
      });

      await failSystemJob(job.id, error.message || 'Unknown nightly reconciliation error', retry.retryDelaySeconds);
      await writeNightlyState({
        scope: normalizeScope((job.payload || {}).scope),
        managerOffset: parseNonNegativeInt((job.payload || {}).manager_offset),
        priorityOffset: parseNonNegativeInt((job.payload || {}).priority_offset),
        status: `failed:${retry.retryKind}`,
      });
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown nightly reconciliation error', {
        retry_kind: retry.retryKind,
        retry_delay_seconds: retry.retryDelaySeconds,
      });

      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown nightly reconciliation error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}