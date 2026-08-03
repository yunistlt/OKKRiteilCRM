import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { enqueueSalaryEstimateClassifyJob } from '@/lib/system-jobs';
import { classifyOrderEstimate, findEstimateCandidates } from '@/lib/salary/estimate-classifier';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.salary_estimate_classify';
const MAX_CONCURRENCY = 1;
// Сколько заказов добирать за один холостой тик. Правило не срочное (влияет на
// расчёт к концу месяца), поэтому бэклог разбираем малыми порциями.
const BACKFILL_BATCH = 20;

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

    const claimed = await claimSystemJobs({
      workerId: `salary-estimate-classify:${Date.now()}`,
      jobTypes: ['salary_estimate_classify'],
      limit: MAX_CONCURRENCY,
      lockSeconds: 300,
      maxProcessing: MAX_CONCURRENCY,
      concurrencyKey: WORKER_KEY,
    });

    // Очередь пуста — добираем бэклог: заказы в статусе правила с текстовым
    // маркером сметы, у которых ещё нет вердикта. Ставим их в ту же очередь,
    // разберём следующими тиками (идемпотентность — по заказу).
    if (!claimed.length) {
      const candidates = await findEstimateCandidates(BACKFILL_BATCH);
      for (const orderId of candidates) {
        await enqueueSalaryEstimateClassifyJob(orderId, 'backfill');
      }
      return NextResponse.json({
        ok: true,
        status: candidates.length ? 'backfilled' : 'idle',
        processed: 0,
        enqueued: candidates.length,
      });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { order_id?: number; source?: string };
      const orderId = payload.order_id;

      if (!orderId) {
        await failSystemJob(job.id, 'Missing order_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const result = await classifyOrderEstimate(orderId);
        await completeSystemJob(job.id, {
          order_id: orderId,
          source: payload.source || 'salary_estimate_classify',
          result: result.status,
          is_estimate: result.isEstimate,
        });
        results.push({ job_id: job.id, order_id: orderId, status: result.status });
      } catch (error: any) {
        const message = error.message || 'Unknown salary estimate classify error';
        const retry = getAdaptiveSystemJobRetry({
          attempts: job.attempts || 0,
          errorMessage: message,
          profile: 'slow',
        });
        await failSystemJob(job.id, message, retry.retryDelaySeconds);
        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'failed',
          error: message,
          retry_kind: retry.retryKind,
          retry_delay_seconds: retry.retryDelaySeconds,
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });

    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown salary estimate classify route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json({ ok: false, error: error.message }, { status: isUnauthorized ? 401 : 500 });
  }
}
