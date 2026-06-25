import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { buildTeamOrders, buildIncomingByManager } from '@/lib/salary/report-details';

export const dynamic = 'force-dynamic';

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

        const { data: periodRow } = await supabase
            .from('salary_period')
            .select('id,status,closed_at,closed_by')
            .eq('year', year)
            .eq('month', month)
            .maybeSingle();

        if (!periodRow) {
            return NextResponse.json({ period: { year, month, status: 'none' }, rows: [], total: 0, isManagerOnly: true });
        }

        const { data: calcRows, error } = await supabase
            .from('salary_calc')
            .select('*')
            .eq('period_id', periodRow.id)
            .eq('manager_id', mid);
        if (error) throw error;

        const { data: mgr } = await supabase
            .from('managers')
            .select('id,first_name,last_name')
            .eq('id', mid)
            .maybeSingle();
        const managerName = mgr
            ? [mgr.first_name, mgr.last_name].filter(Boolean).join(' ') || `#${mid}`
            : `#${mid}`;

        const rows = (calcRows ?? []).map((r: any) => ({ ...r, manager_name: managerName }));
        const total = rows.reduce((s: number, r: any) => s + Number(r.total || 0), 0);

        // Детализация показателей заказами — вместе с отчётом. teamOrders — весь отдел
        // (по решению: прозрачность К_команды и для менеджера); incoming — только своя.
        const team = await buildTeamOrders(periodRow.id);
        const incomingByManager = await buildIncomingByManager(year, month, [Number(mid)]);

        return NextResponse.json({
            period: { year, month, status: periodRow.status, closed_at: periodRow.closed_at, closed_by: periodRow.closed_by },
            rows,
            total,
            isManagerOnly: true,
            details: { teamOrders: team.orders, teamRevenueNoVat: team.teamRevenueNoVat, incoming: incomingByManager[Number(mid)] ?? [] },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
