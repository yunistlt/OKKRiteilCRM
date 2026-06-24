import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { consumeResetToken, type ConsumeReason } from '@/lib/password-reset';

export const dynamic = 'force-dynamic';

const schema = z.object({
    token: z.string().min(1),
    password: z.string().min(6, 'Пароль должен быть не короче 6 символов'),
});

const REASON_MESSAGES: Record<ConsumeReason, string> = {
    invalid: 'Ссылка недействительна. Запросите смену пароля заново.',
    expired: 'Срок действия ссылки истёк. Запросите смену пароля заново.',
    used: 'Ссылка уже использована. Запросите смену пароля заново.',
    error: 'Не удалось сменить пароль. Попробуйте позже.',
};

export async function POST(req: Request) {
    const limited = checkRateLimit(req, 'reset-password', { limit: 10, windowMs: 15 * 60 * 1000 });
    if (limited) return limited;

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        body = {};
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        const message = parsed.error.issues[0]?.message || 'Некорректные данные';
        return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    const result = await consumeResetToken(parsed.data.token, parsed.data.password);
    if (!result.ok) {
        const reason = result.reason || 'error';
        const status = reason === 'error' ? 500 : 400;
        return NextResponse.json({ ok: false, error: REASON_MESSAGES[reason] }, { status });
    }

    return NextResponse.json({ ok: true, message: 'Пароль обновлён. Теперь можно войти.' });
}
