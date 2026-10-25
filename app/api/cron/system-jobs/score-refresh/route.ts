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
/**
 * Сколько работ берёт один заход. Оценка заказа идёт около 25 секунд; шесть штук
 * тройками — это две волны, около минуты, при лимите захода в пять минут.
 */
const MAX_SCORE_CONCURRENCY = 6;
/**
 * Сколько оценок разрешено считать одновременно.
 *
 * Было 2 — ровно столько же, сколько берёт один заход, поэтому следующий заход
 * крона всегда получал пустой ответ и ждал, пока освободится предыдущий. Выходило
 * две работы в минуту, и очередь из 1 159 работ не рассасывалась неделями.
 *
 * Шесть — это три захода внахлёст. Держать такой темп стало безопасно после
 * 17.10.2026: главный пожиратель диска в оценке («звонки заказа» через
 * call_order_link, 1 878 мс на запрос) ускорен до 10 мс.
 */
const MAX_SCORE_PARALLEL = 6;
/** Сколько оценок считаем одновременно внутри одного захода. */
const PARALLEL_EVALUATIONS = 3;

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
      maxProcessing: MAX_SCORE_PARALLEL,
      concurrencyKey: 'system_jobs.order_score_refresh',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    /**
     * Одна оценка заказа — это почти минута ожидания чужих ответов: запросы к
     * базе и к модели. Пока ждём один заказ, можно считать соседние, поэтому
     * работы идут тройками, а не гуськом. Больше трёх не берём: за ними стоит
     * один и тот же диск базы, а он у нас узкое место.
     */
    const processJob = async (job: any) => {
      const payload = (job.payload || {}) as { order_id?: number | string };
      const rawOrderId = payload.order_id;
      const orderId = rawOrderId ? Number(rawOrderId) : NaN;

      if (!Number.isFinite(orderId) || orderId <= 0) {
        await failSystemJob(job.id, 'Missing or invalid order_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        return;
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
    };

    for (let i = 0; i < claimed.length; i += PARALLEL_EVALUATIONS) {
      await Promise.all(claimed.slice(i, i + PARALLEL_EVALUATIONS).map(processJob));
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