import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { randomUUID } from 'crypto';
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
            html,
            replyTo,
            attachments: (attachments || []).map((a) => ({
                filename: a.filename || 'attachment',
                content: a.content,
                contentType: a.contentType || undefined,
            })),
        });
        return { sent: true };
    } catch (error: any) {
        console.error('[email] ошибка отправки:', error?.message || error);
        return { sent: false, error: error?.message || 'send_failed' };
    }
}

// ── Письма по заказу (переписка, привязанная к заказу RetailCRM) ──────────────

/**
 * Служебный тег RetailCRM в теме письма: `[#N/NNNNN]`, где NNNNN — номер заказа,
 * а N — порядковый номер сообщения в переписке по заказу. По этому тегу почтовая
 * интеграция RetailCRM привязывает письмо к заказу (см. docs/email-secretary/OVERVIEW.md,
 * lib/email/classify.ts). Исходящие письма по заказу ОБЯЗАНЫ нести этот тег.
 */
export function buildOrderThreadSubject(orderNumber: string | number, text: string, seq = 1): string {
    return `[#${seq}/${orderNumber}] ${text}`.trim();
}

/** Достаёт номер заказа из служебного тега темы `[#N/NNNNN]`, иначе null. */
export function parseOrderNumberFromSubject(subject: string): string | null {
    const m = subject.match(/\[#\d+\/(\d+)\]/);
    return m ? m[1] : null;
}

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
            html: input.html,
            replyTo: input.replyTo,
            messageId,
            date: new Date(),
            attachments: (input.attachments || []).map((a) => ({
                filename: a.filename || 'attachment',
                content: a.content,
                contentType: a.contentType || undefined,
            })),
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

    // 2) Дозапись копии в «Отправленные» (best-effort: видимость в почте и импорт в RetailCRM).
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
