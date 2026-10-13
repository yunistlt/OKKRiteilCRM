import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { conditionsMet, heartbeat } from '@/lib/read-gate/service';

export const dynamic = 'force-dynamic';

const Body = z.object({
    gateId: z.number().int().positive(),
    // Сколько секунд прошло с прошлой порции С ОТКРЫТОЙ вкладкой.
    seconds: z.number().int().min(0).max(120),
    scrolledToEnd: z.boolean().optional(),
});

/**
 * POST /api/read-gate/beat — порция времени от страницы.
 *
 * Прирост сверяет сервер: больше, чем реально прошло с прошлой порции, не
 * засчитывается. Одним числом в конце время не принимаем вовсе.
 */
export async function POST(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });

    const row = await heartbeat(session.user.id, parsed.data.gateId, parsed.data.seconds, !!parsed.data.scrolledToEnd);
    if (!row) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });

    return NextResponse.json({
        visibleSeconds: row.visible_seconds,
        requiredSeconds: row.required_seconds,
        scrolledToEnd: row.scrolled_to_end,
        ready: conditionsMet(row),
    });
}
