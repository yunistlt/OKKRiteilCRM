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
import { sendNotification } from '@/lib/notify/send';

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
            await warnAboutLostCopies();
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

    const lines = lost.slice(0, 5).map((row) =>
        `№${row.order_number} → ${row.to_email} (${new Date(row.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })})`);

    await sendNotification(
        'mail.sent_copy_missing',
        `Письма ушли клиенту, но копии нет в «Отправленных»: ${lost.length} шт за сутки.\n`
        + lines.join('\n')
        + '\nВ почтовом ящике этих писем не видно — проверьте доступ к ящику.',
    ).catch(() => undefined);

    await supabase
        .from('sync_state')
        .upsert({ key: 'mail_sent_copy_alert_at', value: new Date().toISOString() }, { onConflict: 'key' });
}
