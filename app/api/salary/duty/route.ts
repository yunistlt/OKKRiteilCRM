import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

function monthBounds(period: string): { start: string; end: string } | null {
    const m = period.match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const ny = month === 12 ? year + 1 : year;
    const nm = month === 12 ? 1 : month + 1;
    const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
    return { start, end };
}

// GET /api/salary/duty?period=YYYY-MM — список дежурств/табеля за период
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const { searchParams } = new URL(req.url);
        const bounds = monthBounds(searchParams.get('period') || '');
        if (!bounds) return NextResponse.json({ error: 'period в формате YYYY-MM' }, { status: 400 });

        const { data, error } = await supabase
            .from('salary_duty')
            .select('*')
            .gte('work_date', bounds.start)
            .lt('work_date', bounds.end)
            .order('work_date', { ascending: true });
        if (error) throw error;

        // Список активных менеджеров для выбора в модалке
        const { data: mgrs } = await supabase
            .from('managers')
            .select('id,first_name,last_name,active')
            .eq('active', true)
            .order('first_name', { ascending: true });
        const managers = (mgrs as any[] ?? []).map((m) => ({
            id: m.id,
            name: [m.first_name, m.last_name].filter(Boolean).join(' ') || `#${m.id}`,
        }));

        return NextResponse.json({ rows: data ?? [], managers });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST /api/salary/duty — добавить/обновить запись {manager_id, work_date, kind, shifts, note}
export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const body = await req.json();
        const { manager_id, work_date, kind, shifts, note } = body ?? {};
        if (!manager_id || !work_date) {
            return NextResponse.json({ error: 'Нужны manager_id и work_date' }, { status: 400 });
        }
        const row = {
            manager_id: Number(manager_id),
            work_date,
            kind: kind === 'worked_day' ? 'worked_day' : 'duty',
            shifts: shifts == null ? 1 : Number(shifts),
            note: note ?? null,
            created_by: session?.user?.email ?? null,
        };
        const { error } = await supabase.from('salary_duty').upsert(row, { onConflict: 'manager_id,work_date,kind' });
        if (error) throw error;
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}

// DELETE /api/salary/duty?id=123
export async function DELETE(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 });
        const { error } = await supabase.from('salary_duty').delete().eq('id', Number(id));
        if (error) throw error;
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
