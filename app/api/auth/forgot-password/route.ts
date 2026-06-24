import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { findAccountByEmail, createResetToken } from '@/lib/password-reset';
import { sendAppEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email() });

function appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://okk.zmksoft.com';
}

function buildEmailHtml(link: string): string {
    return `
<div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111827;">
  <h2 style="font-size: 20px; font-weight: 800; margin: 0 0 12px;">Восстановление пароля</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #374151; margin: 0 0 20px;">
    Вы запросили смену пароля в OKKRiteil CRM. Нажмите кнопку ниже, чтобы задать новый пароль.
    Ссылка действует <b>1 час</b>.
  </p>
  <p style="margin: 0 0 24px;">
    <a href="${link}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 700; padding: 12px 24px; border-radius: 10px;">
      Задать новый пароль
    </a>
  </p>
  <p style="font-size: 12px; line-height: 1.6; color: #9ca3af; margin: 0;">
    Если вы не запрашивали смену пароля — просто проигнорируйте это письмо.
    Если кнопка не работает, скопируйте ссылку в браузер:<br>
    <span style="color: #6b7280; word-break: break-all;">${link}</span>
  </p>
</div>`;
}

export async function POST(req: Request) {
    const limited = checkRateLimit(req, 'forgot-password', { limit: 5, windowMs: 15 * 60 * 1000 });
    if (limited) return limited;

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        body = {};
    }

    // Всегда отвечаем одинаково, чтобы не раскрывать, какие email существуют.
    const generic = NextResponse.json({
        ok: true,
        message: 'Если такой email зарегистрирован, мы отправили на него ссылку для смены пароля.',
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) return generic;

    const target = await findAccountByEmail(parsed.data.email);
    if (!target) return generic;

    const token = await createResetToken(target);
    if (!token) return generic;

    const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    await sendAppEmail({
        to: target.email,
        subject: 'Восстановление пароля — OKKRiteil CRM',
        html: buildEmailHtml(link),
    });

    return generic;
}
