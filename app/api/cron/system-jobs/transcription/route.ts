import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { getCallTranscriptionPreflight, isSelfHostedSttConfigured, markCallTranscriptionSkipped, submitCallTranscription, transcribeCall } from '@/lib/transcribe';
import { enqueueTranscriptionDownstream } from '@/lib/transcription-downstream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.transcription';
// STT-сервер последовательный (одна очередь, один звонок за раз) — шлём по одному,
// иначе второй звонок ждёт в очереди сервера и легко упирается в таймаут клиента/функции.
const MAX_TRANSCRIPTION_CONCURRENCY = 1;

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

    // PERF: claimed jobs are independent — process the batch concurrently instead of
    // serially, so the claim window (lockSeconds) is used in parallel rather than summed.
    const processJob = async (job: typeof claimed[number]): Promise<Record<string, any>> => {
      const payload = (job.payload || {}) as {
        telphin_call_id?: string;
        recording_url?: string;
      };

      const callId = payload.telphin_call_id;
      const recordingUrl = payload.recording_url;

      if (!callId || !recordingUrl) {
        await failSystemJob(job.id, 'Missing telphin_call_id or recording_url', 300);
        return { job_id: job.id, status: 'failed_validation' };
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
          return {
            job_id: job.id,
            telphin_call_id: callId,
            status: 'skipped',
            reason: preflight.skipReason,
          };
        }

        // Phase 3: skip if already completed (idempotency guard at job level)
        if (preflight.row.transcription_status === 'completed' && preflight.row.transcript) {
          await completeSystemJob(job.id, {
            telphin_call_id: callId,
            status: 'already_completed',
          });
          return { job_id: job.id, telphin_call_id: callId, status: 'already_completed' };
        }

        // Async-режим (свой STT-сервер): только отправляем звонок в очередь STT и сохраняем
        // job_id — результат заберёт крон-поллер. Снимает лимит длины звонка (maxDuration 300с).
        if (isSelfHostedSttConfigured()) {
          const submit = await submitCallTranscription(callId, recordingUrl);
          await completeSystemJob(job.id, { telphin_call_id: callId, status: submit.state, stt_job_id: submit.jobId });
          return { job_id: job.id, telphin_call_id: callId, status: submit.state, stt_job_id: submit.jobId };
        }

        // Синхронный режим (OpenAI Whisper): расшифровываем и сразу ставим downstream.
        await transcribeCall(callId, recordingUrl);
        const downstream = await enqueueTranscriptionDownstream(callId, 'call_transcription_worker', job.id);
        await completeSystemJob(job.id, { telphin_call_id: callId, next_jobs: downstream.jobs });
        return { job_id: job.id, telphin_call_id: callId, status: 'completed', order_id: downstream.orderId };
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
          return { job_id: job.id, telphin_call_id: callId, status: 'terminal_error', error: msg };
        } else {
          const retry = getAdaptiveSystemJobRetry({
            attempts: job.attempts || 0,
            errorMessage: msg,
            profile: 'fast',
          });
          await failSystemJob(job.id, msg, retry.retryDelaySeconds);
          return {
            job_id: job.id,
            telphin_call_id: callId,
            status: 'failed',
            error: msg,
            retry_kind: retry.retryKind,
            retry_delay_seconds: retry.retryDelaySeconds,
          };
        }
      }
    };

    const results = await Promise.all(claimed.map(processJob));

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