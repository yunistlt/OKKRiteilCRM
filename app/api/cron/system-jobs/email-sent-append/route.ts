/**
 * Дозапись отправленных писем в папку «Отправленные».
 *
 * Менеджер не должен ждать, пока письмо уедет во второй раз — уже в ящик по
 * IMAP (просьба Лены Парфёновой 09.10.2026: «быстрее отправку писем можно
 * сделать?»). Отправка по SMTP остаётся мгновенной, копия в Sent уезжает
 * отсюда, в ближайшую минуту.
 *
 * Зачем копия вообще: письмо должно быть видно в самом почтовом ящике — его
 * читают с телефона и из почтового клиента, а не только в ОКК.
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
import { supabase } from '@/utils/supabase';
import { appendToSentFolder } from '@/lib/email/imap';
import { SENT_QUEUE_BUCKET } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'system_jobs.email_sent_append';
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
            workerId: `email-sent-append:${Date.now()}`,
            jobTypes: ['email_sent_append'],
            limit: MAX_CONCURRENCY,
            lockSeconds: 180,
            maxProcessing: MAX_CONCURRENCY,
            concurrencyKey: WORKER_KEY,
        });

        if (!claimed.length) {
            await recordWorkerSuccess(WORKER_KEY, { processed: 0 });
            return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
        }

        let appended = 0;
        const results: Array<Record<string, unknown>> = [];

        for (const job of claimed) {
            const payload = (job.payload || {}) as { path?: string; messageId?: string; subject?: string };
            const path = String(payload.path ?? '');

            if (!path) {
                await failSystemJob(job.id, 'В задаче нет пути к письму', 3600);
                results.push({ job: job.id, status: 'нет пути' });
                continue;
            }

            const stored = await supabase.storage.from(SENT_QUEUE_BUCKET).download(path);
            if (stored.error || !stored.data) {
                // Файла нет — повторять нечего: письмо клиенту уже ушло.
                await failSystemJob(job.id, `Письмо не нашлось в хранилище: ${stored.error?.message ?? 'нет файла'}`, 3600);
                results.push({ job: job.id, status: 'письма нет в хранилище' });
                continue;
            }

            const raw = Buffer.from(new Uint8Array(await stored.data.arrayBuffer()));
            const result = await appendToSentFolder(raw);

            if (!result.appended) {
                // Пусть попробует ещё раз: ящик бывает недоступен минутами.
                await failSystemJob(job.id, `Ящик не принял копию: ${result.error ?? 'неизвестно'}`, 120);
                results.push({ job: job.id, status: 'ящик не принял', error: result.error });
                continue;
            }

            /**
             * Отмечаем в журнале отправок, что копия на месте.
             *
             * Журнал пишется в момент отправки, когда копия ещё в очереди, —
             * без этой отметки он навсегда утверждал бы «копии нет», и
             * интерфейс пугал бы менеджера зря.
             */
            if (payload.messageId) {
                await supabase
                    .from('order_email_sends')
                    .update({ appended_to_sent: true })
                    .eq('message_id', payload.messageId);
            }

            // Легло — файл в хранилище больше не нужен.
            await supabase.storage.from(SENT_QUEUE_BUCKET).remove([path]).catch(() => undefined);
            await completeSystemJob(job.id, { folder: result.folder, messageId: payload.messageId });
            appended += 1;
            results.push({ job: job.id, status: 'в «Отправленных»', folder: result.folder });
        }

        await recordWorkerSuccess(WORKER_KEY, { processed: claimed.length, appended });
        return NextResponse.json({ ok: true, processed: claimed.length, appended, results });
    } catch (error: any) {
        await recordWorkerFailure(WORKER_KEY, error?.message ?? String(error));
        return NextResponse.json({ ok: false, error: error?.message ?? String(error) }, { status: 500 });
    }
}
