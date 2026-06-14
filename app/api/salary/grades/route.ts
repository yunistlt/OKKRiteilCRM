import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { listGradeLedger, recomputeGrades, resolveGradePolicy, resolveManagerGrades, saveGradePolicy, setManagerGrade } from '@/lib/salary/grades';

export const dynamic = 'force-dynamic';

function asOfParam(req: Request): string {
    const u = new URL(req.url);
    return u.searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
}

// GET — политика + леджер + текущие грейды на дату + менеджеры (для вкладки «Грейды»).
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const asOf = asOfParam(req);
        const [policy, ledger, current, mgrs] = await Promise.all([
            resolveGradePolicy(asOf).catch(() => null),
            listGradeLedger(),
            resolveManagerGrades(asOf),
            supabase.from('managers').select('id,first_name,last_name,active').order('id', { ascending: true }),
        ]);
        const managers = ((mgrs.data as any[]) ?? []).map((m) => ({ id: Number(m.id), name: [m.first_name, m.last_name].filter(Boolean).join(' ') || `#${m.id}`, active: m.active }));
        return NextResponse.json({ asOf, policy, ledger, current: Array.from(current.entries()).map(([managerId, level]) => ({ managerId, level })), managers });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST — пересчёт грейдов по последнему закрытому месяцу { throughYear, throughMonth }.
export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const body = await req.json();
        const throughYear = Number(body.throughYear);
        const throughMonth = Number(body.throughMonth);
        if (!throughYear || !throughMonth) return NextResponse.json({ error: 'Нужны throughYear и throughMonth' }, { status: 400 });
        const result = await recomputeGrades(throughYear, throughMonth, session?.user?.email ?? null);
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}

// PUT — ручной грейд { action:'set', managerId, level, effectiveFrom } ИЛИ
//       новая версия политики { action:'policy', policy, effectiveFrom }.
export async function PUT(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        const body = await req.json();
        const actor = session?.user?.email ?? null;
        if (body.action === 'policy') {
            if (!body.policy || !body.effectiveFrom) return NextResponse.json({ error: 'Нужны policy и effectiveFrom' }, { status: 400 });
            await saveGradePolicy({ policy: body.policy, effectiveFrom: String(body.effectiveFrom), actor });
            return NextResponse.json({ ok: true });
        }
        const managerId = Number(body.managerId);
        const level = Number(body.level);
        const effectiveFrom = String(body.effectiveFrom || '');
        if (!managerId || !Number.isFinite(level) || !effectiveFrom) return NextResponse.json({ error: 'Нужны managerId, level, effectiveFrom' }, { status: 400 });
        await setManagerGrade({ managerId, level, effectiveFrom, actor });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
