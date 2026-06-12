import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { listPlans, savePlan, resolveManagerComp } from '@/lib/salary/schemes';

export const dynamic = 'force-dynamic';

function parsePeriod(req: Request): { year: number; month: number } | null {
    const period = new URL(req.url).searchParams.get('period') || '';
    const m = period.match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return null;
    return { year: Number(m[1]), month: Number(m[2]) };
}

// GET /api/salary/plans?period=YYYY-MM — планы месяца + менеджеры.
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const p = parsePeriod(req);
        if (!p) return NextResponse.json({ error: 'period в формате YYYY-MM' }, { status: 400 });
        // Планы — только для реестра ОП (участники salary_participant с назначенной схемой),
        // то есть тех же, по кому считается зарплата. Иначе показывались бы все менеджеры,
        // включая системные аккаунты (Администратор и т.п.).
        const asOf = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
        const [plans, comp] = await Promise.all([
            listPlans(p.year, p.month),
            resolveManagerComp(asOf),
        ]);
        const rosterIds = Array.from(comp.keys());
        let managers: { id: number; name: string; active: boolean }[] = [];
        if (rosterIds.length) {
            const { data: mgrs } = await supabase
                .from('managers')
                .select('id,first_name,last_name,active')
                .in('id', rosterIds);
            managers = ((mgrs as any[]) ?? [])
                .map((m) => ({ id: Number(m.id), name: [m.first_name, m.last_name].filter(Boolean).join(' ') || `#${m.id}`, active: m.active }))
                .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        }
        return NextResponse.json({ period: p, plans, managers });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// PUT — сохранить план { year, month, managerId|null, target|null }
export async function PUT(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const body = await req.json();
        const year = Number(body.year);
        const month = Number(body.month);
        if (!year || !month) return NextResponse.json({ error: 'Нужны year и month' }, { status: 400 });
        await savePlan({
            year,
            month,
            managerId: body.managerId == null ? null : Number(body.managerId),
            target: body.target == null || body.target === '' ? null : Number(body.target),
            actor: session?.user?.email ?? null,
        });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
