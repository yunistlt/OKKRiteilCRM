import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { DEFER_REASONS, defer } from '@/lib/read-gate/service';
import { sendNotification } from '@/lib/notify/send';

export const dynamic = 'force-dynamic';

const Body = z.object({
    gateId: z.number().int().positive(),
    reason: z.enum(DEFER_REASONS),
});

/**
 * POST /api/read-gate/defer — «срочное дело, прочитаю позже».
 *
 * Открывает работу на час, записывает причину и говорит об этом руководителю.
 * Отсрочка — не лазейка, а честная запись: без неё отдел найдёт обход, и мы
 * потеряем сам сигнал о том, читают разбор или нет.
 */
export async function POST(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Укажите причину отсрочки' }, { status: 400 });

    const result = await defer(session.user.id, parsed.data.gateId, parsed.data.reason);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const who = [session.user.last_name, session.user.first_name].filter(Boolean).join(' ') || session.user.username;
    const until = new Date(result.until!).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    // Провал уведомления не отменяет отсрочку: человек уже отложил чтение.
    await sendNotification(
        'sales.read_gate_deferred',
        `⏳ <b>${who}</b> отложил разбор: ${parsed.data.reason}.\nРабота открыта до ${until}, потом разбор вернётся.`,
        {},
    ).catch(() => null);

    return NextResponse.json({ ok: true, until: result.until });
}
