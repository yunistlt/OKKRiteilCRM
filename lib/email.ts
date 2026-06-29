import nodemailer from 'nodemailer';

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
