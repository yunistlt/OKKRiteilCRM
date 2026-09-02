import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { buildTeamOrders, buildIncomingByManager } from '@/lib/salary/report-details';
import { getRecalcState } from '@/lib/salary/recalc-state';
import { getResolvedConfig } from '@/lib/salary/config';
import { listEngineerDictionary } from '@/lib/salary/schemes';
import { loadPeriodView } from '@/lib/salary/period-view';
import { buildAdminDashboard } from '@/lib/salary/admin-dashboard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // открытый период считается на лету

// GET /api/salary?period=YYYY-MM
// Открытый период — расчёт на лету из боевых данных; закрытый — зафиксированный снимок.
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

        const view = await loadPeriodView(year, month);
        if (view.status === 'none') {
            return NextResponse.json({ period: { year, month, status: 'none' }, rows: [], total: 0 });
        }

        // Менеджер видит только свою строку; admin/rop — все.
        const role = session?.user?.role;
        const isManagerOnly = role === 'manager';
        let respRows = view.rows;
        if (isManagerOnly) {
            const mid = session?.user?.retail_crm_manager_id;
            if (mid == null) {
                return NextResponse.json({ period: { year, month, status: view.status }, rows: [], total: 0 });
            }
            respRows = view.rows.filter((r) => Number(r.manager_id) === Number(mid));
        }

        // Имена менеджеров
        const managerIds = Array.from(new Set(respRows.map((r) => r.manager_id)));
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

        const rows = respRows.map((r) => ({ ...r, manager_name: namesById.get(r.manager_id) || `#${r.manager_id}` }));
        const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);

        // Детализация показателей заказами — отдаём вместе с отчётом (без ленивых дозапросов).
        // teamOrders — весь отдел (для открытого периода — live-строки); incoming — по менеджерам ответа.
        const team = await buildTeamOrders(view.periodId!, view.rows);
        const incomingManagerIds = rows.map((r) => Number(r.manager_id));
        const incomingByManager = await buildIncomingByManager(year, month, incomingManagerIds);

        // Открытый период считается на лету → всегда актуален (пересчёт не требуется).
        // Закрытый — сверяем снимок с изменениями мотивации.
        const recalcState = view.live
            ? { needsRecalc: false, changedAt: null as string | null }
            : await getRecalcState(view.periodId!, view.status, year, month);

        // Инженеры-расчётчики (только для admin/rop; менеджер видит лишь свою строку).
        let engineers: any[] = [];
        let engineersTotal = 0;
        if (!isManagerOnly && view.engineerRows.length) {
            let nameByCode = new Map<string, string>();
            try {
                const cfg = await getResolvedConfig(`${year}-${String(month).padStart(2, '0')}-01`);
                const dict = await listEngineerDictionary(cfg.engineer_field.code);
                nameByCode = new Map(dict.map((d) => [d.itemCode, d.name]));
            } catch { /* справочник не синкнут — покажем item_code */ }
            engineers = view.engineerRows.map((r) => ({ ...r, engineer_name: nameByCode.get(r.item_code) || r.item_code }));
            engineersTotal = engineers.reduce((s, r) => s + Number(r.total || 0), 0);
        }

        // Панель руководителя (вкладка «Дашборд») — только admin/rop. Считается поверх
        // уже посчитанных строк периода; если упадёт — ведомость всё равно отдаём.
        let dashboard: any = null;
        if (!isManagerOnly && rows.length) {
            try {
                dashboard = await buildAdminDashboard({
                    year,
                    month,
                    rows,
                    teamRevenueNoVat: team.teamRevenueNoVat,
                    engineersFot: engineersTotal,
                });
            } catch (e: any) {
                console.error('[salary] buildAdminDashboard failed:', e?.message);
            }
        }

        return NextResponse.json({
            period: { year, month, status: view.status, closed_at: view.closedAt, closed_by: view.closedBy },
            rows,
            total,
            isManagerOnly,
            dashboard,
            needsRecalc: recalcState.needsRecalc,
            recalcChangedAt: recalcState.changedAt,
            details: { teamOrders: team.orders, teamRevenueNoVat: team.teamRevenueNoVat, incomingByManager },
            engineers,
            engineersTotal,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
