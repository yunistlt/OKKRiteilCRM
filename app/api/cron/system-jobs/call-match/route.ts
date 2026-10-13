import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  calculateCallTranscriptionPriority,
  claimSystemJobs,
  completeSystemJob,
  enqueueCallSemanticRulesJob,
  enqueueOrderRefreshJob,
  failSystemJob,
  isSystemJobsPipelineRuntimeEnabled,
  safeEnqueueCallTranscriptionJob,
} from '@/lib/system-jobs';
import { bindCallStrict } from '@/lib/call-binding';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.call_match';
const MAX_CALL_MATCH_CONCURRENCY = 1;

function ensureAuthorized(req: NextRequest) {
  if (!isCronHeaderAuthorized(req)) {
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

    if (!(await isSystemJobsPipelineRuntimeEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const workerId = `call-match-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['call_match'],
      limit: MAX_CALL_MATCH_CONCURRENCY,
      lockSeconds: 180,
      maxProcessing: MAX_CALL_MATCH_CONCURRENCY,
      concurrencyKey: 'system_jobs.call_match',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { telphin_call_id?: string };
      const callId = payload.telphin_call_id;
      const matchedAt = new Date().toISOString();

      if (!callId) {
        await failSystemJob(job.id, 'Missing telphin_call_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const { data: callRow, error } = await supabase
          .from('raw_telphin_calls')
          .select('*')
          .eq('telphin_call_id', callId)
          .limit(1)
          .single();

        if (error || !callRow) {
          throw new Error(`Call ${callId} not found in raw_telphin_calls`);
        }

        /**
         * Привязка по правилам ОКК, а не догадка по телефону.
         *
         * Закон владельца 05.10.2026: «мы уже ничего не матчим». Старый матчинг
         * угадывал заказ по номеру и ошибался примерно в трети случаев — за 90
         * дней 1 285 его привязок из 1 776 оказались даже не разговорами, а
         * попытками дозвона. Теперь звонок привязывается, только когда
         * толкование одно: клиент опознан и у него ровно один открытый заказ.
         * Всё остальное указывает менеджер руками в карточке входящего.
         */
        const boundOrderIds = await bindCallStrict({
          telphin_call_id: callRow.telphin_call_id,
          direction: callRow.direction,
          from_number: callRow.from_number,
          to_number: callRow.to_number,
          from_number_normalized: callRow.from_number_normalized,
          to_number_normalized: callRow.to_number_normalized,
        });

        if (boundOrderIds.length > 0) {
          const uniqueOrderIds = boundOrderIds;
          const { data: workingSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_working', true);

          const workingCodes = new Set((workingSettings || []).map((item: any) => item.code));
          const { data: matchedOrders } = await supabase
            .from('orders')
            .select('id, status')
            .in('id', uniqueOrderIds);

          const hasWorkingOrderMatch = (matchedOrders || []).some((order: any) => workingCodes.has(order.status));

          if (callRow.recording_url && !callRow.transcript && callRow.transcription_status !== 'completed' && callRow.transcription_status !== 'processing' && callRow.transcription_status !== 'skipped') {
            await safeEnqueueCallTranscriptionJob({
              callId,
              source: 'call_match_worker',
              recordingUrl: callRow.recording_url,
              startedAt: callRow.started_at,
              hasWorkingOrderMatch,
              priority: calculateCallTranscriptionPriority({
                startedAt: callRow.started_at,
                hasWorkingOrderMatch,
              }),
              payload: {
                matched_order_ids: uniqueOrderIds,
                recording_ready_at: callRow.raw_payload?._recording_ready_at || null,
              },
              parentJobId: job.id,
            });
          }

          if (callRow.transcription_status === 'completed' && callRow.transcript) {
            await enqueueCallSemanticRulesJob({
              callId,
              source: 'call_match_worker',
              payload: {
                matched_order_ids: uniqueOrderIds,
              },
              priority: 20,
              parentJobId: job.id,
            });
          }

          for (const orderId of uniqueOrderIds) {
            await enqueueOrderRefreshJob({
              jobType: 'order_score_refresh',
              orderId,
              source: 'call_match_worker',
              payload: {
                telphin_call_id: callId,
                call_matched_at: matchedAt,
              },
              priority: 25,
            });
          }
        }

        await completeSystemJob(job.id, {
          telphin_call_id: callId,
          matches_found: boundOrderIds.length,
          semantic_rules_enqueued: boundOrderIds.length > 0 && callRow.transcription_status === 'completed' && !!callRow.transcript,
          matched_order_ids: boundOrderIds,
        });

        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'completed',
          matches_found: boundOrderIds.length,
        });
      } catch (error: any) {
        await failSystemJob(job.id, error.message || 'Unknown call match worker error', getRetryDelay(job.attempts || 0));
        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'failed',
          error: error.message,
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });
    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown call match route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}