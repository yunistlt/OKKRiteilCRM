import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { buildTeamOrders, buildIncomingByManager } from '@/lib/salary/report-details';
import { getRecalcState } from '@/lib/salary/recalc-state';
import { buildMyDashboard } from '@/lib/salary/my-dashboard';
import { loadPeriodView } from '@/lib/salary/period-view';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // открытый период считается на лету

// GET /api/salary/my?period=YYYY-MM
// Личная зарплата вызывающего: всегда скоуп «только своя строка» по retail_crm_manager_id.
// Отдельно от /api/salary (admin/rop, все строки + recalc/close), чтобы менеджер не получал
// доступ к чужим данным и опасным операциям закрытия периода.
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

        const mid = session?.user?.retail_crm_manager_id;
        if (mid == null) {
            // Аккаунт не привязан к менеджеру RetailCRM — личного расчёта нет.
            return NextResponse.json({ period: { year, month, status: 'none' }, rows: [], total: 0, isManagerOnly: true });
        }

        const view = await loadPeriodView(year, month, { includeEngineers: false });
        if (view.status === 'none') {
            return NextResponse.json({ period: { year, month, status: 'none' }, rows: [], total: 0, isManagerOnly: true });
        }

        const { data: mgr } = await supabase
            .from('managers')
            .select('id,first_name,last_name')
            .eq('id', mid)
            .maybeSingle();
        const managerName = mgr
            ? [mgr.first_name, mgr.last_name].filter(Boolean).join(' ') || `#${mid}`
            : `#${mid}`;

        const myRows = view.rows.filter((r) => Number(r.manager_id) === Number(mid));
        const rows = myRows.map((r) => ({ ...r, manager_name: managerName }));
        const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);

        // Детализация показателей заказами — вместе с отчётом. teamOrders — весь отдел
        // (прозрачность К_команды и для менеджера, поэтому передаём все live-строки);
        // incoming — только своя.
        const team = await buildTeamOrders(view.periodId!, view.rows);
        const incomingByManager = await buildIncomingByManager(year, month, [Number(mid)]);

        // Открытый период считается на лету → всегда актуален; закрытый — сверяем снимок.
        const recalcState = view.live
            ? { needsRecalc: false, changedAt: null as string | null }
            : await getRecalcState(view.periodId!, view.status, year, month);

        // Приборная панель: план/темп/предоплата/рубежи/пороги/грейд поверх расчёта.
        // periodRows — live-строки отдела (конверсия отдела без устаревшего снимка).
        const dashboard = await buildMyDashboard({
            year,
            month,
            managerId: Number(mid),
            row: rows[0] ?? null,
            teamRevenueNoVat: team.teamRevenueNoVat,
            periodId: view.periodId!,
            periodRows: view.rows,
        });

        return NextResponse.json({
            period: { year, month, status: view.status, closed_at: view.closedAt, closed_by: view.closedBy },
            rows,
            total,
            isManagerOnly: true,
            needsRecalc: recalcState.needsRecalc,
            recalcChangedAt: recalcState.changedAt,
            details: { teamOrders: team.orders, teamRevenueNoVat: team.teamRevenueNoVat, incoming: incomingByManager[Number(mid)] ?? [] },
            dashboard,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
