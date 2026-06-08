import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { recalcAndPersist } from '@/lib/salary/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/salary/close  body: { year, month }
// Финально пересчитывает период (снимок) и блокирует его: salary_calc неизменяем,
// дальнейшие правки — только через корректировки. Аудитируется.
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
        const actor = session?.user?.email ?? null;

        // 1. Финальный пересчёт-снимок (бросит, если период уже закрыт)
        await recalcAndPersist(Number(year), Number(month), actor);

        // 2. Блокировка периода
        const closedAt = new Date().toISOString();
        const { data: updated, error } = await supabase
            .from('salary_period')
            .update({ status: 'closed', closed_at: closedAt, closed_by: actor })
            .eq('year', Number(year))
            .eq('month', Number(month))
            .select('id')
            .single();
        if (error) throw error;

        await supabase.from('salary_audit_log').insert({
            entity: 'period',
            entity_id: String(updated.id),
            action: 'close',
            actor,
            old_value: { status: 'open' },
            new_value: { status: 'closed', closed_at: closedAt },
        });

        return NextResponse.json({ ok: true, status: 'closed', closed_at: closedAt });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
