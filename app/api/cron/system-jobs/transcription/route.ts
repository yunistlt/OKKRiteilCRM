import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueCallSemanticRulesJob,
  enqueueOrderRefreshJob,
  failSystemJob,
  isSystemJobsPipelineEnabled,
} from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { getCallTranscriptionPreflight, markCallTranscriptionSkipped, transcribeCall } from '@/lib/transcribe';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.transcription';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function getRetryDelay(attempts: number) {
  if (attempts <= 1) return 30;
  if (attempts === 2) return 120;
  if (attempts === 3) return 300;
  return 900;
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!isSystemJobsPipelineEnabled()) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const workerId = `transcription-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['call_transcription'],
      limit: 2,
      lockSeconds: 240,
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

        await transcribeCall(callId, recordingUrl);

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
            },
            priority: 25,
          });
        }

        await completeSystemJob(job.id, {
          telphin_call_id: callId,
          next_jobs: match?.retailcrm_order_id ? ['call_semantic_rules', 'order_score_refresh'] : [],
        });

        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'completed',
          order_id: match?.retailcrm_order_id || null,
        });
      } catch (error: any) {
        await failSystemJob(job.id, error.message || 'Unknown transcription worker error', getRetryDelay(job.attempts || 0));
        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'failed',
          error: error.message,
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
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown transcription route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}