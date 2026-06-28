import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { buildTeamOrders, buildIncomingByManager } from '@/lib/salary/report-details';
import { getRecalcState } from '@/lib/salary/recalc-state';

export const dynamic = 'force-dynamic';

// GET /api/salary?period=YYYY-MM
// Возвращает сохранённый расчёт периода по менеджерам + статус периода.
// admin/rop — все строки; manager — только своя (по retail_crm_manager_id).
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop', 'manager'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const period = searchParams.get('period') || '';
        const m = period.match(/^(\d{4})-(\d{1,2})$/);
        if (!m) {
            return NextResponse.json({ error: 'period в формате YYYY-MM' }, { status: 400 });
        }
        const year = Number(m[1]);
        const month = Number(m[2]);

        const { data: periodRow } = await supabase
            .from('salary_period')
            .select('id,status,closed_at,closed_by')
            .eq('year', year)
            .eq('month', month)
            .maybeSingle();

        if (!periodRow) {
            return NextResponse.json({ period: { year, month, status: 'none' }, rows: [], total: 0 });
        }

        let query = supabase.from('salary_calc').select('*').eq('period_id', periodRow.id);

        // Менеджер видит только свою строку
        const role = session?.user?.role;
        const isManagerOnly = role === 'manager';
        if (isManagerOnly) {
            const mid = session?.user?.retail_crm_manager_id;
            if (mid == null) {
                return NextResponse.json({ period: { year, month, status: periodRow.status }, rows: [], total: 0 });
            }
            query = query.eq('manager_id', mid);
        }

        const { data: calcRows, error } = await query;
        if (error) throw error;

        // Имена менеджеров
        const managerIds = Array.from(new Set((calcRows ?? []).map((r: any) => r.manager_id)));
        const namesById = new Map<number, string>();
        if (managerIds.length) {
            const { data: mgrs } = await supabase
                .from('managers')
                .select('id,first_name,last_name')
                .in('id', managerIds);
            for (const mgr of (mgrs as any[]) ?? []) {
                namesById.set(mgr.id, [mgr.first_name, mgr.last_name].filter(Boolean).join(' ') || `#${mgr.id}`);
            }
        }

        const rows = (calcRows ?? []).map((r: any) => ({ ...r, manager_name: namesById.get(r.manager_id) || `#${r.manager_id}` }));
        const total = rows.reduce((s: number, r: any) => s + Number(r.total || 0), 0);

        // Детализация показателей заказами — отдаём вместе с отчётом (без ленивых дозапросов).
        // teamOrders — весь отдел (из сохранённых расчётов); incoming — по тем менеджерам, что в ответе.
        const team = await buildTeamOrders(periodRow.id);
        const incomingManagerIds = (rows as any[]).map((r) => Number(r.manager_id));
        const incomingByManager = await buildIncomingByManager(year, month, incomingManagerIds);

        // Устарел ли расчёт относительно изменений мотивации (нужен пересчёт).
        const recalcState = await getRecalcState(periodRow.id, periodRow.status, year, month);

        return NextResponse.json({
            period: { year, month, status: periodRow.status, closed_at: periodRow.closed_at, closed_by: periodRow.closed_by },
            rows,
            total,
            isManagerOnly,
            needsRecalc: recalcState.needsRecalc,
            recalcChangedAt: recalcState.changedAt,
            details: { teamOrders: team.orders, teamRevenueNoVat: team.teamRevenueNoVat, incomingByManager },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
