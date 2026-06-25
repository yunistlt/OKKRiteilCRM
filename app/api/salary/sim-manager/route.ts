import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { getConfigForPeriod } from '@/lib/salary/config';
import { collectPeriodMetrics } from '@/lib/salary/metrics';
import { businessDaysInMonth, loadCategoryNames } from '@/lib/salary/engine';
import { getPlansForPeriod, resolveManagerComp } from '@/lib/salary/schemes';
import { resolveManagerGrades } from '@/lib/salary/grades';
import { toSimBase, type SimManagerBase } from '@/lib/salary/sim-shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/salary/sim-manager?year=&month=&id=
// Срез показателей ОДНОГО менеджера + блоки его назначенной схемы — для
// персонального симулятора ЗП. Пересчёт идёт на клиенте (sim-shared), сервер
// лишь отдаёт baseline. Менеджер видит только свой id (чужого получить нельзя).
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop', 'manager'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const url = new URL(req.url);
        const year = Number(url.searchParams.get('year'));
        const month = Number(url.searchParams.get('month'));
        if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
            return NextResponse.json({ error: 'Некорректный период' }, { status: 400 });
        }

        // Менеджер — только свой id (параметр игнорируем); admin/rop — любой.
        const role = session?.user?.role;
        const ownId = session?.user?.retail_crm_manager_id ?? null;
        let id: number;
        if (role === 'manager') {
            if (ownId == null) return NextResponse.json({ error: 'Профиль не привязан к менеджеру RetailCRM' }, { status: 400 });
            id = ownId;
        } else {
            id = Number(url.searchParams.get('id'));
            if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Не задан менеджер' }, { status: 400 });
        }

        const asOf = `${year}-${String(month).padStart(2, '0')}-01`;
        const config = await getConfigForPeriod(year, month);
        const metrics = await collectPeriodMetrics(year, month, config);
        const plans = await getPlansForPeriod(year, month);
        const grades = await resolveManagerGrades(asOf);
        const comp = await resolveManagerComp(asOf);
        const categoryNames = await loadCategoryNames();
        const businessDays = businessDaysInMonth(year, month);
        const baseTeamRev = metrics.teamRevenueNoVat;

        const managerComp = comp.get(id);
        if (!managerComp) {
            return NextResponse.json({ error: 'Менеджеру не назначена схема оплаты (нет в реестре ОП).' }, { status: 400 });
        }

        const m = metrics.managers.find((x) => x.managerId === id);
        const share = m && baseTeamRev > 0 ? m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0) / baseTeamRev : 0;
        const base: SimManagerBase = m
            ? toSimBase(m, share, grades.get(id) ?? null, plans.personal.get(id) ?? null)
            : emptyBase(id, grades.get(id) ?? null, plans.personal.get(id) ?? null);

        const { data: nameRows } = await supabase.from('managers').select('id,first_name,last_name').eq('id', id);
        const nr = (nameRows as any[])?.[0];
        base.name = nr ? ([nr.last_name, nr.first_name].filter(Boolean).join(' ') || `ID ${id}`) : `ID ${id}`;

        const blocks = managerComp.blocks.map((b) => ({ block_code: b.code, params: b.params ?? {} }));

        return NextResponse.json({
            ok: true, year, month,
            base, blocks,
            schemeCode: managerComp.schemeCode,
            businessDays,
            baseTeamRev: Math.round(baseTeamRev),
            deptPlan: plans.department ?? null,
            personalPlan: plans.personal.get(id) ?? null,
            categoryNames,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}

function emptyBase(id: number, grade: number | null, planTarget: number | null): SimManagerBase {
    return {
        id, name: '', share: 0, baseRevenue: 0, baseOrders: 0,
        countsByType: { new: 0, permanent: 0 }, countsByCategory: {}, revenueByCategory: {},
        sameDayShare: 0, discountMetricValue: null, qualityAvgScore: null, qualityScriptPct: null,
        fastContactShare: null, fieldsFilledShare: null, conversionPct: 0, conversionDenominator: 0,
        dutyShifts: 0, grade, planTarget,
    };
}
