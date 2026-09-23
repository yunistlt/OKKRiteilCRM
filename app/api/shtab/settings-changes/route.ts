import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { applyProposal, listProposals, rejectProposal } from '@/lib/settings-registry/proposals';

export const dynamic = 'force-dynamic';

// Предложения Тамары изменить настройку сервиса.
//
// GET  — что ждёт решения (и чем кончились прошлые).
// POST — решение владельца: применить или отклонить.
//
// Доступ: RBAC /api/shtab → только admin. Настройка, применённая кем угодно
// кроме владельца, — это ровно то, от чего страхует вся эта развилка.

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const status = req.nextUrl.searchParams.get('status') as any;
        const items = await listProposals({ status: status || undefined, limit: 30 });
        return NextResponse.json({ proposals: items });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

const DecisionSchema = z.object({
    id: z.number().int().positive(),
    decision: z.enum(['apply', 'reject']),
    /**
     * Подтверждение поверх расхождения: настройка изменилась с момента
     * предложения, человек увидел оба значения и всё равно ставит новое.
     */
    force: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = DecisionSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const actor = session.user.email || String(session.user.id ?? 'владелец');

        const proposal =
            parsed.data.decision === 'apply'
                ? await applyProposal(parsed.data.id, actor, { force: parsed.data.force })
                : await rejectProposal(parsed.data.id, actor);

        return NextResponse.json({ proposal });
    } catch (e: any) {
        // Расхождение значения — не поломка, а вопрос к человеку: отвечаем 409,
        // чтобы интерфейс показал разницу и спросил ещё раз, а не «ошибка».
        const conflict = /изменилась с момента предложения/.test(String(e.message));
        return NextResponse.json({ error: e.message }, { status: conflict ? 409 : 500 });
    }
}
