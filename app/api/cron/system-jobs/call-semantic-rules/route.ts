import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueOrderRefreshJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { runRuleEngine } from '@/lib/rule-engine';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.call_semantic_rules';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!(await isSystemJobsPipelineRuntimeEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const workerId = `call-semantic-rules-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['call_semantic_rules'],
      limit: 5,
      lockSeconds: 240,
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { telphin_call_id?: string };
      const callId = payload.telphin_call_id;

      if (!callId) {
        await failSystemJob(job.id, 'Missing telphin_call_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const [{ data: callRow, error: callError }, { data: matchRow, error: matchError }] = await Promise.all([
          supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, event_id, started_at, transcript, transcription_status')
            .eq('telphin_call_id', callId)
            .limit(1)
            .single(),
          supabase
            .from('call_order_matches')
            .select('retailcrm_order_id')
            .eq('telphin_call_id', callId)
            .order('matched_at', { ascending: false })
            .limit(1)
            .single(),
        ]);

        if (callError || !callRow) {
          throw new Error(`Call ${callId} not found in raw_telphin_calls`);
        }

        if (!callRow.started_at) {
          throw new Error(`Call ${callId} has no started_at`);
        }

        if (callRow.transcription_status !== 'completed' || !callRow.transcript) {
          const retry = getAdaptiveSystemJobRetry({
            attempts: job.attempts || 0,
            errorMessage: `Transcript is not ready for call ${callId}`,
            profile: 'fast',
          });
          await failSystemJob(job.id, `Transcript is not ready for call ${callId}`, retry.retryDelaySeconds);
          results.push({ job_id: job.id, telphin_call_id: callId, status: 'waiting_transcript', retry_kind: retry.retryKind, retry_delay_seconds: retry.retryDelaySeconds });
          continue;
        }

        if (matchError || !matchRow?.retailcrm_order_id) {
          const retry = getAdaptiveSystemJobRetry({
            attempts: job.attempts || 0,
            errorMessage: `Matched order is not ready for call ${callId}`,
            profile: 'fast',
          });
          await failSystemJob(job.id, `Matched order is not ready for call ${callId}`, retry.retryDelaySeconds);
          results.push({ job_id: job.id, telphin_call_id: callId, status: 'waiting_match', retry_kind: retry.retryKind, retry_delay_seconds: retry.retryDelaySeconds });
          continue;
        }

        const violationsFound = await runRuleEngine(
          callRow.started_at,
          callRow.started_at,
          undefined,
          false,
          undefined,
          undefined,
          matchRow.retailcrm_order_id,
          {
            ruleType: 'semantic',
            entityType: 'call',
            targetCallId: callId,
            targetOrderId: matchRow.retailcrm_order_id,
          }
        );
        const semanticRulesCompletedAt = new Date().toISOString();

        await enqueueOrderRefreshJob({
          jobType: 'order_score_refresh',
          orderId: matchRow.retailcrm_order_id,
          source: 'call_semantic_rules_worker',
          payload: {
            telphin_call_id: callId,
            violations_found: violationsFound,
            semantic_rules_completed_at: semanticRulesCompletedAt,
          },
          priority: 25,
          parentJobId: job.id,
        });

        await completeSystemJob(job.id, {
          telphin_call_id: callId,
          retailcrm_order_id: matchRow.retailcrm_order_id,
          violations_found: violationsFound,
          next_jobs: ['order_score_refresh'],
        });

        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          retailcrm_order_id: matchRow.retailcrm_order_id,
          status: 'completed',
          violations_found: violationsFound,
        });
      } catch (error: any) {
        const retry = getAdaptiveSystemJobRetry({
          attempts: job.attempts || 0,
          errorMessage: error.message || 'Unknown semantic rules worker error',
          profile: 'fast',
        });
        await failSystemJob(job.id, error.message || 'Unknown semantic rules worker error', retry.retryDelaySeconds);
        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'failed',
          error: error.message,
          retry_kind: retry.retryKind,
          retry_delay_seconds: retry.retryDelaySeconds,
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });

    return NextResponse.json({
      ok: true,
      status: 'processed',
      processed: results.length,
      results,
    });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown semantic rules route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}