import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  failSystemJob,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { evaluateOrder } from '@/lib/okk-evaluator';
import { refreshStoredPriorityForOrder } from '@/lib/prioritization';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.score_refresh';
const MAX_SCORE_CONCURRENCY = 2;

function ensureAuthorized(req: NextRequest) {
  if (!isCronHeaderAuthorized(req)) {
    throw new Error('Unauthorized');
  }
}

function getRetryDelay(attempts: number) {
  if (attempts <= 1) return 60;
  if (attempts === 2) return 180;
  if (attempts === 3) return 600;
  return 1800;
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!(await isSystemJobsPipelineRuntimeEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const workerId = `score-refresh-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['order_score_refresh'],
      limit: MAX_SCORE_CONCURRENCY,
      lockSeconds: 240,
      maxProcessing: MAX_SCORE_CONCURRENCY,
      concurrencyKey: 'system_jobs.order_score_refresh',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { order_id?: number | string };
      const rawOrderId = payload.order_id;
      const orderId = rawOrderId ? Number(rawOrderId) : NaN;

      if (!Number.isFinite(orderId) || orderId <= 0) {
        await failSystemJob(job.id, 'Missing or invalid order_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        await evaluateOrder(orderId);

        const priorityResult = await refreshStoredPriorityForOrder(orderId, true);
        const managerId = priorityResult.managerId ? Number(priorityResult.managerId) : null;

        // Показатели менеджера здесь НЕ заказываем.
        //
        // Раньше после каждого пересчёта балла сюда ставилась просьба обновить
        // показатели его менеджера. Но пересчёт показателей берёт ВСЕ данные за
        // 35 дней и считает человека целиком — одной просьбы хватило бы на всех.
        // А выходило по одной на каждый заказ: 1 293 задания за неделю на трёх
        // человек, и 687 из них висели в очереди мёртвым грузом (разбор
        // 16.10.2026). Защита от дублей работает в окне в минуту и такие пачки
        // не схлопывает: ночная сверка идёт сорок минут.
        //
        // С 16.10.2026 показатели считаются по расписанию раз в три часа, для
        // всех сразу — цепочка стала лишней.

        await completeSystemJob(job.id, {
          order_id: orderId,
          processed: 1,
          errors: 0,
          priority_status: priorityResult.status,
          manager_id: managerId,
        });

        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'completed',
          processed: 1,
          errors: 0,
          priority_status: priorityResult.status,
          manager_id: managerId,
        });
      } catch (error: any) {
        await failSystemJob(job.id, error.message || 'Unknown score refresh worker error', getRetryDelay(job.attempts || 0));
        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'failed',
          error: error.message,
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });
    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown score refresh route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}