import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { getConfigForPeriod } from '@/lib/salary/config';
import { collectPeriodMetrics } from '@/lib/salary/metrics';
import { businessDaysInMonth } from '@/lib/salary/engine';
import { getPlansForPeriod } from '@/lib/salary/schemes';
import { resolveManagerGrades } from '@/lib/salary/grades';
import { toSimBase, type SimManagerBase } from '@/lib/salary/sim-shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/salary/sim-baseline?year=&month=&ids=10,98,249
// Реальный срез метрик baseline-месяца для интерактивного симулятора ФОТ.
// Дальше пересчёт идёт на клиенте (compute-shared) — сервер ничего не считает на ползунках.
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const url = new URL(req.url);
        const year = Number(url.searchParams.get('year'));
        const month = Number(url.searchParams.get('month'));
        const ids = (url.searchParams.get('ids') ?? '').split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
        if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
            return NextResponse.json({ error: 'Некорректный период' }, { status: 400 });
        }
        if (!ids.length) return NextResponse.json({ error: 'Не заданы менеджеры' }, { status: 400 });

        const asOf = `${year}-${String(month).padStart(2, '0')}-01`;
        const config = await getConfigForPeriod(year, month);
        const metrics = await collectPeriodMetrics(year, month, config);
        const plans = await getPlansForPeriod(year, month);
        const grades = await resolveManagerGrades(asOf);
        const businessDays = businessDaysInMonth(year, month);
        const baseTeamRev = metrics.teamRevenueNoVat;

        const metricsById = new Map(metrics.managers.map((m) => [m.managerId, m]));
        const { data: nameRows } = await supabase.from('managers').select('id,first_name,last_name').in('id', ids);
        const nameById = new Map<number, string>();
        for (const n of (nameRows as any[]) ?? []) nameById.set(Number(n.id), [n.last_name, n.first_name].filter(Boolean).join(' ') || `ID ${n.id}`);

        const managers: SimManagerBase[] = ids.map((id) => {
            const m = metricsById.get(id);
            const share = m && baseTeamRev > 0 ? m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0) / baseTeamRev : 0;
            const base = m
                ? toSimBase(m, share, grades.get(id) ?? null, plans.personal.get(id) ?? null)
                : emptyBase(id, grades.get(id) ?? null, plans.personal.get(id) ?? null);
            base.name = nameById.get(id) ?? `ID ${id}`;
            return base;
        });

        return NextResponse.json({
            ok: true, year, month, baseTeamRev: Math.round(baseTeamRev), businessDays,
            deptPlan: plans.department ?? null, managers,
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
