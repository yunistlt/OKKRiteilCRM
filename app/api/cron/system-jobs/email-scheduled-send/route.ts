/**
 * Отложенные письма: отправляем, когда пришло время.
 *
 * Письмо, назначенное на утро, не должно жить в браузере — человек уйдёт
 * домой, и оно не уедет. Оно лежит в очереди задач и уходит отсюда, тем же
 * кодом доставки, что и обычная отправка (`deliverOrderLetter`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import {
    claimSystemJobs,
    completeSystemJob,
    failSystemJob,
    isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { deliverOrderLetter, LetterProblem, type LetterToDeliver } from '@/lib/orders/deliver-letter';
import { findSendByClientKey } from '@/lib/order-email-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'system_jobs.email_scheduled_send';
const MAX_CONCURRENCY = 2;

export async function GET(req: NextRequest) {
    try {
        if (!isCronHeaderAuthorized(req)) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }

        if (!(await isSystemJobsPipelineRuntimeEnabled())) {
            return NextResponse.json({ ok: true, status: 'disabled' });
        }

        const claimed = await claimSystemJobs({
            workerId: `email-scheduled-send:${Date.now()}`,
            jobTypes: ['email_scheduled_send'],
            limit: MAX_CONCURRENCY,
            lockSeconds: 180,
            maxProcessing: MAX_CONCURRENCY,
            concurrencyKey: WORKER_KEY,
        });

        if (!claimed.length) {
            await recordWorkerSuccess(WORKER_KEY, { processed: 0 });
            return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
        }

        let sent = 0;
        const results: Array<Record<string, unknown>> = [];

        for (const job of claimed) {
            const payload = (job.payload || {}) as { letter?: LetterToDeliver; actor?: string | null };
            const letter = payload.letter;

            if (!letter?.to || !letter?.html) {
                await failSystemJob(job.id, 'В задаче нет письма', 3600);
                results.push({ job: job.id, status: 'пустая задача' });
                continue;
            }

            // Письмо уже уходило (например, отправили руками, не дождавшись) —
            // второй раз не шлём.
            if (letter.clientKey && await findSendByClientKey(letter.clientKey)) {
                await completeSystemJob(job.id, { status: 'уже отправлено руками' });
                results.push({ job: job.id, status: 'уже отправлено' });
                continue;
            }

            try {
                const delivery = await deliverOrderLetter(letter, payload.actor ?? null);
                if (!delivery.ok) {
                    // Почта не приняла — пробуем ещё раз через пять минут.
                    await failSystemJob(job.id, `Письмо не ушло: ${delivery.result.error ?? 'неизвестно'}`, 300);
                    results.push({ job: job.id, status: 'не ушло', error: delivery.result.error });
                    continue;
                }

                await completeSystemJob(job.id, { subject: delivery.result.subject, messageId: delivery.result.messageId });
                sent += 1;
                results.push({ job: job.id, status: 'отправлено', order: letter.orderNumber });
            } catch (e: any) {
                // Документ не собрался или письмо негодное — повторять незачем.
                const hopeless = e instanceof LetterProblem;
                await failSystemJob(job.id, String(e?.message ?? e), hopeless ? 3600 : 300);
                results.push({ job: job.id, status: 'сбой', error: String(e?.message ?? e) });
            }
        }

        await recordWorkerSuccess(WORKER_KEY, { processed: claimed.length, sent });
        return NextResponse.json({ ok: true, processed: claimed.length, sent, results });
    } catch (error: any) {
        await recordWorkerFailure(WORKER_KEY, error?.message ?? String(error));
        return NextResponse.json({ ok: false, error: error?.message ?? String(error) }, { status: 500 });
    }
}
