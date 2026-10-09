import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { randomUUID } from 'crypto';
import { linkifyHtml } from '@/lib/html-links';
import { brandAttachment, wrapInBrand } from '@/lib/email-brand';
import { appendToSentFolder } from './email/imap';

/**
 * Общая отправка писем через Yandex SMTP (как в app/api/widget/wishlist-email).
 * Деградирует мягко: если SMTP не настроен — возвращает { sent: false }, не бросает.
 */

export function isEmailConfigured(): boolean {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransporter() {
    return nodemailer.createTransport({
        host: 'smtp.yandex.ru',
        port: 465,
        secure: true,
        auth: {
            user: process.env.SMTP_USER, // rop@zmktlt.ru
            pass: process.env.SMTP_PASS, // пароль приложения Яндекс 360
        },
    });
}

export interface EmailAttachment {
    filename: string | null;
    content: Buffer;
    contentType?: string | null;
}

export interface SendEmailInput {
    to: string;
    subject: string;
    html: string;
    fromName?: string;
    replyTo?: string;                 // адрес для «Ответить» (напр. исходный отправитель)
    attachments?: EmailAttachment[];  // вложения для пересылки
}

export async function sendAppEmail({ to, subject, html, fromName = 'OKKRiteil CRM', replyTo, attachments }: SendEmailInput): Promise<{ sent: boolean; error?: string }> {
    if (!isEmailConfigured()) {
        console.warn('[email] SMTP не настроен (SMTP_USER/SMTP_PASS) — письмо не отправлено');
        return { sent: false, error: 'smtp_not_configured' };
    }

    try {
        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"${fromName}" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html: wrapInBrand(linkifyHtml(html)),
            replyTo,
            attachments: [brandAttachment(), ...(attachments || []).map((a) => ({
                filename: a.filename || 'attachment',
                content: a.content,
                contentType: a.contentType || undefined,
            }))],
        });
        return { sent: true };
    } catch (error: any) {
        console.error('[email] ошибка отправки:', error?.message || error);
        return { sent: false, error: error?.message || 'send_failed' };
    }
}

// ── Письма по заказу (переписка, привязанная к заказу RetailCRM) ──────────────

/** Текст письма из его HTML — для текстовой части MIME и для ленты переписки. */
export function htmlToPlainText(html: string): string {
    return String(html ?? '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Служебный тег RetailCRM в теме письма: `[#N/NNNNN]`, где NNNNN — номер заказа,
 * а N — порядковый номер сообщения в переписке по заказу. По этому тегу почтовая
 * интеграция RetailCRM привязывает письмо к заказу (см. docs/email-secretary/OVERVIEW.md,
 * lib/email/classify.ts). Исходящие письма по заказу ОБЯЗАНЫ нести этот тег.
 */
// Разбор и сборка темы живут отдельно (`lib/email-subject.ts`): ими пользуется
// и браузер, а сюда тянется nodemailer.
import { buildOrderThreadSubject } from './email-subject';

export { buildOrderThreadSubject, stripOrderThreadTag, parseOrderNumberFromSubject } from './email-subject';

export interface SendOrderEmailInput {
    to: string;
    orderNumber: string | number;
    subjectText: string;          // человеческая часть темы (без тега) — тег добавится сам
    html: string;
    seq?: number;                 // порядковый номер сообщения в переписке (по умолчанию 1)
    fromName?: string;
    replyTo?: string;             // по умолчанию НЕ задаём: ответ должен вернуться в ящик rop@ для привязки в CRM
    attachments?: EmailAttachment[];
}

export interface SendOrderEmailResult {
    sent: boolean;
    appendedToSent: boolean;      // легла ли копия в «Отправленные» (нужно для видимости в CRM)
    /** Копия в «Отправленные» встала в очередь и уйдёт туда фоном, в ближайшую минуту. */
    appendQueued?: boolean;
    subject: string;
    messageId?: string;
    sentFolder?: string;
    error?: string;
    appendError?: string;
}

/**
 * Отправляет письмо по заказу так, чтобы оно было ВИДНО в почте и привязалось к заказу в RetailCRM:
 *  1) тема получает служебный тег `[#N/NNNNN]` (привязка к заказу);
 *  2) письмо собирается в MIME один раз и отправляется по SMTP;
 *  3) та же самая копия (тот же Message-ID) дозаписывается в «Отправленные» по IMAP —
 *     иначе прямая SMTP-отправка не попадает ни в Sent, ни в RetailCRM.
 *
 * Важно: дозапись в Sent идёт по IMAP (порт 993). В РФ-окружении IMAP часто режется DPI —
 * функцию следует вызывать из боевого окружения (Vercel), где IMAP-интеграция почты уже работает.
 */
export async function sendOrderEmail(input: SendOrderEmailInput): Promise<SendOrderEmailResult> {
    const subject = buildOrderThreadSubject(input.orderNumber, input.subjectText, input.seq ?? 1);

    if (!isEmailConfigured()) {
        return { sent: false, appendedToSent: false, subject, error: 'smtp_not_configured' };
    }

    const user = process.env.SMTP_USER as string;
    const fromName = input.fromName || 'ЗМК';
    const messageId = `<${randomUUID()}@zmktlt.ru>`;

    // Собираем MIME один раз — чтобы отправленная и дозаписанная в Sent копии были идентичны.
    let raw: Buffer;
    try {
        const composer = new MailComposer({
            from: `"${fromName}" <${user}>`,
            to: input.to,
            subject,
            html: wrapInBrand(linkifyHtml(input.html)),
            // Текстовая часть обязательна: без неё письмо в папке «Отправленные»
            // лежит одним HTML, и лента переписки по заказу показывает пустоту.
            text: htmlToPlainText(input.html),
            replyTo: input.replyTo,
            messageId,
            date: new Date(),
            attachments: [
                // Логотип письма вкладываем картинкой: ссылку почтовые клиенты
                // блокируют, и шапка оставалась бы пустой.
                brandAttachment(),
                ...(input.attachments || []).map((a) => ({
                    filename: a.filename || 'attachment',
                    content: a.content,
                    contentType: a.contentType || undefined,
                })),
            ],
        });
        raw = await new Promise<Buffer>((resolve, reject) =>
            composer.compile().build((err, msg) => (err ? reject(err) : resolve(msg)))
        );
    } catch (error: any) {
        return { sent: false, appendedToSent: false, subject, error: error?.message || 'compose_failed' };
    }

    // 1) Отправка по SMTP той самой собранной копии.
    try {
        const transporter = createTransporter();
        await transporter.sendMail({ envelope: { from: user, to: input.to }, raw });
    } catch (error: any) {
        console.error('[email] sendOrderEmail SMTP error:', error?.message || error);
        return { sent: false, appendedToSent: false, subject, messageId, error: error?.message || 'send_failed' };
    }

    /**
     * 2) Копия в «Отправленные» — ФОНОМ.
     *
     * Это отдельное соединение с ящиком: TLS, вход и заливка всего письма с
     * вложениями. Секунды, которые менеджер стоял и ждал уже отправленное
     * письмо («быстрее отправку писем можно сделать?» — Лена Парфёнова
     * 09.10.2026). Для клиента копия в Sent ничего не меняет: письмо у него
     * уже есть.
     *
     * Кладём письмо в очередь задач — её разбирает крон раз в минуту. Если
     * очередь недоступна, дозаписываем здесь же: лучше подождать, чем
     * потерять копию.
     */
    const queued = await queueSentAppend(raw, messageId, subject);
    if (queued) {
        return { sent: true, appendedToSent: false, appendQueued: true, subject, messageId };
    }

    const appended = await appendToSentFolder(raw);
    if (!appended.appended) {
        console.warn('[email] sendOrderEmail: письмо отправлено, но НЕ дозаписано в Sent:', appended.error);
    }

    return {
        sent: true,
        appendedToSent: appended.appended,
        subject,
        messageId,
        sentFolder: appended.folder,
        appendError: appended.appended ? undefined : appended.error,
    };
}

/** Где лежат письма, ждущие дозаписи в «Отправленные». */
export const SENT_QUEUE_BUCKET = 'okk-assets';
export const SENT_QUEUE_PREFIX = 'outgoing-mime';

/**
 * Положить готовое письмо в очередь на дозапись в «Отправленные».
 *
 * Само письмо кладём в хранилище, а в задачу — путь: MIME с вложениями весит
 * мегабайты, в поле задачи ему не место.
 *
 * Возвращает true, если задача встала в очередь.
 */
async function queueSentAppend(raw: Buffer, messageId: string, subject: string): Promise<boolean> {
    try {
        const { supabase } = await import('@/utils/supabase');
        const { safeEnqueueSystemJob } = await import('@/lib/system-jobs');

        const key = messageId.replace(/[<>]/g, '').replace(/[^a-zA-Z0-9._@-]/g, '-');
        const path = `${SENT_QUEUE_PREFIX}/${key}.eml`;

        const upload = await supabase.storage
            .from(SENT_QUEUE_BUCKET)
            .upload(path, new Uint8Array(raw), { contentType: 'message/rfc822', upsert: true });
        if (upload.error) {
            console.warn('[email] письмо не легло в хранилище для дозаписи:', upload.error.message);
            return false;
        }

        const job = await safeEnqueueSystemJob({
            jobType: 'email_sent_append',
            payload: { path, messageId, subject },
            priority: 40,
            // Одно письмо — одна дозапись, сколько бы раз задача ни повторилась.
            idempotencyKey: `email_sent_append:${key}`,
            maxAttempts: 5,
        });

        if (!job) {
            await supabase.storage.from(SENT_QUEUE_BUCKET).remove([path]).catch(() => undefined);
            return false;
        }

        return true;
    } catch (e: any) {
        console.warn('[email] очередь дозаписи недоступна, пишем в Sent сразу:', e?.message ?? e);
        return false;
    }
}
