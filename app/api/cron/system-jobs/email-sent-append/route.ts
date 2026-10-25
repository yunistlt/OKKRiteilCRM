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
import { appendCopiesToSent } from '@/lib/email/imap';
import { SENT_QUEUE_BUCKET } from '@/lib/email';
import { sendNotification } from '@/lib/notify/send';
import { sentCopyRetryDelay } from '@/lib/email/sent-copy-retry';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'system_jobs.email_sent_append';
/** Письма одной пачки уезжают в ящик по ОДНОМУ соединению — берём больше. */
const BATCH = 10;

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
            limit: BATCH,
            lockSeconds: 180,
            maxProcessing: BATCH,
            concurrencyKey: WORKER_KEY,
        });

        if (!claimed.length) {
            await warnAboutLostCopies();
            await recordWorkerSuccess(WORKER_KEY, { processed: 0 });
            return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
        }

        let appended = 0;
        const results: Array<Record<string, unknown>> = [];

        /**
         * Сначала достаём тела писем из хранилища, потом одним соединением
         * кладём их в «Отправленные». Соединение с ящиком — самая дорогая
         * часть: вход, список папок, TLS. На письмо их больше не тратим.
         */
        const ready: Array<{ id: string; raw: Buffer; messageId?: string | null }> = [];
        const jobById = new Map<string, (typeof claimed)[number]>();

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

            jobById.set(String(job.id), job);
            ready.push({
                id: String(job.id),
                raw: Buffer.from(new Uint8Array(await stored.data.arrayBuffer())),
                messageId: payload.messageId ?? null,
            });
        }

        const outcomes = await appendCopiesToSent(ready);

        for (const item of ready) {
            const job = jobById.get(item.id)!;
            const payload = (job.payload || {}) as { path?: string; messageId?: string };
            const result = outcomes.get(item.id) ?? { appended: false, error: 'нет ответа' };

            if (!result.appended) {
                /**
                 * Пусть попробует ещё раз, и не раз: ящик бывает недоступен
                 * минутами, а бывает — часами. Повтор безопасен, потому что
                 * перед записью мы ищем письмо по Message-ID.
                 */
                const delay = sentCopyRetryDelay(Number((job as any).attempts ?? 1));
                await failSystemJob(job.id, `Ящик не принял копию: ${result.error ?? 'неизвестно'}`, delay);
                results.push({ job: job.id, status: 'ящик не принял', error: result.error, снова_через_мин: Math.round(delay / 60) });
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
            await supabase.storage.from(SENT_QUEUE_BUCKET).remove([String(payload.path)]).catch(() => undefined);
            await completeSystemJob(job.id, { folder: result.folder, messageId: payload.messageId, already: result.already ?? false });
            appended += 1;
            results.push({
                job: job.id,
                status: result.already ? 'уже была в «Отправленных»' : 'в «Отправленных»',
                folder: result.folder,
            });
        }

        await warnAboutLostCopies();

        await recordWorkerSuccess(WORKER_KEY, { processed: claimed.length, appended });
        return NextResponse.json({ ok: true, processed: claimed.length, appended, results });
    } catch (error: any) {
        await recordWorkerFailure(WORKER_KEY, error?.message ?? String(error));
        return NextResponse.json({ ok: false, error: error?.message ?? String(error) }, { status: 500 });
    }
}

/**
 * Письма, ушедшие клиенту, но не легшие в «Отправленные».
 *
 * Критерий готовности из ТЗ переписки (§10): «ни одного исходящего, которого
 * нет в Отправленных». Молчаливый провал тут опаснее всего — письмо у клиента
 * есть, а у нас его как будто не было, и ответ клиента может не найти заказ.
 *
 * Говорим один раз в час и только о письмах старше часа: минутные задержки —
 * это нормальная работа очереди.
 */
async function warnAboutLostCopies(): Promise<void> {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

    const { data } = await supabase
        .from('order_email_sends')
        .select('order_number, to_email, created_at')
        .eq('appended_to_sent', false)
        .gt('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
        .lt('created_at', hourAgo)
        .order('created_at', { ascending: false })
        .limit(20);

    const lost = (data ?? []) as any[];
    if (!lost.length) return;

    const { data: state } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', 'mail_sent_copy_alert_at')
        .maybeSingle();

    const lastAt = new Date(String((state as any)?.value ?? 0)).getTime();
    if (Number.isFinite(lastAt) && Date.now() - lastAt < 3_600_000) return;

    /**
     * Сдались или ещё пробуем — разные новости. С лестницей повторов копия
     * может лежать в очереди часами и это нормально; тревожно, когда задача
     * ушла в мёртвые: по этому письму мы уже ничего не делаем.
     */
    const { count: deadCount } = await supabase
        .from('system_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('job_type', 'email_sent_append')
        .eq('status', 'dead_letter')
        .gt('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString());

    const lines = lost.slice(0, 5).map((row) =>
        `№${row.order_number} → ${row.to_email} (${new Date(row.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })})`);

    await sendNotification(
        'mail.sent_copy_missing',
        `Письма ушли клиенту, но копии нет в «Отправленных»: ${lost.length} шт за сутки.\n`
        + lines.join('\n')
        + (deadCount
            ? `\nИз них ${deadCount} — уже без повторов (ящик отказал все попытки). Нужны руки.`
            : '\nПовторы продолжаются: копия ляжет сама, как только ящик её примет.')
        + '\nВ почтовом ящике этих писем не видно — проверьте доступ к ящику.',
    ).catch(() => undefined);

    await supabase
        .from('sync_state')
        .upsert({ key: 'mail_sent_copy_alert_at', value: new Date().toISOString() }, { onConflict: 'key' });
}
