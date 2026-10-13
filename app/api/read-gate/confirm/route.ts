import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { confirm } from '@/lib/read-gate/service';

export const dynamic = 'force-dynamic';

const Body = z.object({ gateId: z.number().int().positive() });

/**
 * POST /api/read-gate/confirm — «прочитал, приступаю к работе».
 *
 * Условия проверяет сервер по собственным данным. Запрос напрямую, в обход
 * страницы, раньше срока ничего не даст.
 */
export async function POST(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });

    const result = await confirm(session.user.id, parsed.data.gateId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
}
