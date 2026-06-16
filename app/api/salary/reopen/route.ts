import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// POST /api/salary/reopen  body: { year, month }
// Безопасно переоткрывает закрытый период: status → 'open'. Только админ. Аудитируется.
// Снимок salary_calc остаётся как есть — числа меняются только при последующем «Пересчитать».
export async function POST(req: Request) {
    try {
        const session = await getSession();
        // Переоткрытие — операция повышенного риска (трогает «замороженный» период), только админ.
        if (!hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ error: 'Переоткрытие периода доступно только администратору' }, { status: 403 });
        }
        const { year, month } = await req.json();
        if (!year || !month) {
            return NextResponse.json({ error: 'Нужны year и month' }, { status: 400 });
        }
        const actor = session?.user?.email ?? null;

        const { data: periodRow, error: selErr } = await supabase
            .from('salary_period')
            .select('id,status,closed_at')
            .eq('year', Number(year))
            .eq('month', Number(month))
            .maybeSingle();
        if (selErr) throw selErr;
        if (!periodRow) {
            return NextResponse.json({ error: 'Период не найден' }, { status: 404 });
        }
        if (periodRow.status !== 'closed') {
            return NextResponse.json({ error: 'Период не закрыт — переоткрывать нечего' }, { status: 400 });
        }

        const { error: updErr } = await supabase
            .from('salary_period')
            .update({ status: 'open', closed_at: null, closed_by: null })
            .eq('id', periodRow.id);
        if (updErr) throw updErr;

        await supabase.from('salary_audit_log').insert({
            entity: 'period',
            entity_id: String(periodRow.id),
            action: 'reopen',
            actor,
            old_value: { status: 'closed', closed_at: periodRow.closed_at },
            new_value: { status: 'open' },
        });

        return NextResponse.json({ ok: true, status: 'open' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
