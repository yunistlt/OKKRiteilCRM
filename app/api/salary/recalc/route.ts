import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { recalcAndPersist } from '@/lib/salary/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/salary/recalc  body: { year, month }
// Считает период из боевых данных и сохраняет в salary_calc. Период должен быть открыт.
export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const { year, month } = await req.json();
        if (!year || !month) {
            return NextResponse.json({ error: 'Нужны year и month' }, { status: 400 });
        }
        const calc = await recalcAndPersist(Number(year), Number(month), session?.user?.email ?? null);
        return NextResponse.json({ ok: true, ...calc });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
