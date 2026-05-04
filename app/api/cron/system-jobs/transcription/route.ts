import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueCallSemanticRulesJob,
  enqueueOrderRefreshJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { getCallTranscriptionPreflight, markCallTranscriptionSkipped, transcribeCall } from '@/lib/transcribe';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.transcription';
const MAX_TRANSCRIPTION_CONCURRENCY = 2;

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

    const workerId = `transcription-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['call_transcription'],
      limit: MAX_TRANSCRIPTION_CONCURRENCY,
      lockSeconds: 240,
      maxProcessing: MAX_TRANSCRIPTION_CONCURRENCY,
      concurrencyKey: 'system_jobs.call_transcription',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as {
        telphin_call_id?: string;
        recording_url?: string;
      };

      const callId = payload.telphin_call_id;
      const recordingUrl = payload.recording_url;

      if (!callId || !recordingUrl) {
        await failSystemJob(job.id, 'Missing telphin_call_id or recording_url', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const preflight = await getCallTranscriptionPreflight(callId);
        if (!preflight.transcribable) {
          await markCallTranscriptionSkipped(callId, preflight.skipReason || 'Skipped before OpenAI');
          await completeSystemJob(job.id, {
            telphin_call_id: callId,
            status: 'skipped',
            reason: preflight.skipReason,
          });
          results.push({
            job_id: job.id,
            telphin_call_id: callId,
            status: 'skipped',
            reason: preflight.skipReason,
          });
          continue;
        }

        // Phase 3: skip if already completed (idempotency guard at job level)
        if (preflight.row.transcription_status === 'completed' && preflight.row.transcript) {
          await completeSystemJob(job.id, {
            telphin_call_id: callId,
            status: 'already_completed',
          });
          results.push({ job_id: job.id, telphin_call_id: callId, status: 'already_completed' });
          continue;
        }

        await transcribeCall(callId, recordingUrl);
        const transcriptCompletedAt = new Date().toISOString();

        // Phase 4: downstream enqueue is best-effort — transcription completion must not depend on it
        let downstreamJobs: string[] = [];
        try {
          const { data: match } = await supabase
            .from('call_order_matches')
            .select('retailcrm_order_id')
            .eq('telphin_call_id', callId)
            .order('matched_at', { ascending: false })
            .limit(1)
            .single();

          if (match?.retailcrm_order_id) {
            await enqueueCallSemanticRulesJob({
              callId,
              source: 'call_transcription_worker',
              payload: {
                retailcrm_order_id: match.retailcrm_order_id,
                transcript_completed_at: transcriptCompletedAt,
              },
              priority: 20,
              parentJobId: job.id,
            });

            await enqueueOrderRefreshJob({
              jobType: 'order_score_refresh',
              orderId: match.retailcrm_order_id,
              source: 'call_transcription_worker',
              payload: {
                telphin_call_id: callId,
                transcript_completed_at: transcriptCompletedAt,
              },
              priority: 25,
            });

            await enqueueOrderRefreshJob({
              jobType: 'order_insight_refresh',
              orderId: match.retailcrm_order_id,
              source: 'call_transcription_worker',
              payload: {
                telphin_call_id: callId,
                transcript_completed_at: transcriptCompletedAt,
              },
              priority: 35,
              parentJobId: job.id,
            });

            downstreamJobs = ['call_semantic_rules', 'order_score_refresh', 'order_insight_refresh'];
          }
        } catch (downstreamErr: any) {
          console.error(`[TranscriptionWorker] Downstream enqueue failed for ${callId}, ignoring:`, downstreamErr.message);
        }

        await completeSystemJob(job.id, {
          telphin_call_id: callId,
          next_jobs: downstreamJobs,
        });

        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'completed',
          order_id: match?.retailcrm_order_id || null,
        });
      } catch (error: any) {
        const msg = error.message || 'Unknown transcription worker error';

        // Phase 5: terminal errors — do not retry, go straight to dead_letter
        const isTerminal =
          msg.includes('not found in raw_telphin_calls') ||
          msg.includes('has no recording URL') ||
          msg.includes('is marked as skipped') ||
          msg.includes('Missing telphin_call_id');

        if (isTerminal) {
          await failSystemJob(job.id, msg, 0); // 0 delay + max_attempts exhausted = dead_letter on next fail_system_job call
          results.push({ job_id: job.id, telphin_call_id: callId, status: 'terminal_error', error: msg });
        } else {
          const retry = getAdaptiveSystemJobRetry({
            attempts: job.attempts || 0,
            errorMessage: msg,
            profile: 'fast',
          });
          await failSystemJob(job.id, msg, retry.retryDelaySeconds);
          results.push({
            job_id: job.id,
            telphin_call_id: callId,
            status: 'failed',
            error: msg,
            retry_kind: retry.retryKind,
            retry_delay_seconds: retry.retryDelaySeconds,
          });
        }
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
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown transcription route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}