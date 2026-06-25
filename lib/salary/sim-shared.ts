// ============================================================================
// Общий слой для интерактивного симулятора ФОТ (клиент + сервер).
// Тянет только ЧИСТЫЙ compose() (без supabase) — поэтому безопасен в браузере.
// Сервер строит компактный срез метрик (SimManagerBase), клиент мгновенно
// масштабирует объём и пересчитывает ФОТ тем же движком при движении ползунков.
// ============================================================================
import { compose, type ComposeResult } from '@/lib/salary/blocks/compose';
import type { BlockComputeContext, BlockInstance } from '@/lib/salary/blocks/types';
import type { CountedOrder, ManagerMetrics, OrderType } from '@/lib/salary/metrics';

/** Компактный срез метрик менеджера за baseline-месяц — достаточно для масштабирования объёма. */
export interface SimManagerBase {
    id: number;
    name: string;
    share: number; // доля менеджера в выручке отдела (baseline)
    baseRevenue: number; // выручка без НДС за baseline-месяц
    baseOrders: number; // число засчитанных заказов
    countsByType: Record<OrderType, number>;
    countsByCategory: Record<string, number>;
    revenueByCategory: Record<string, number>;
    sameDayShare: number; // доля «в день обращения» (0..1)
    discountMetricValue: number | null;
    qualityAvgScore: number | null;
    qualityScriptPct: number | null;
    fastContactShare: number | null;
    fieldsFilledShare: number | null;
    conversionPct: number;
    conversionDenominator: number;
    dutyShifts: number;
    grade: number | null;
    planTarget: number | null; // личный план baseline-месяца (если задан)
}

/** Свернуть полные метрики менеджера в компактный срез (вызывается на сервере). */
export function toSimBase(m: ManagerMetrics, share: number, grade: number | null, planTarget: number | null): SimManagerBase {
    const baseRevenue = m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0);
    const baseOrders = m.countedOrders.length;
    const sameDay = m.countedOrders.filter((o) => o.createdAt && o.enteredAt && String(o.createdAt).slice(0, 10) === String(o.enteredAt).slice(0, 10)).length;
    return {
        id: m.managerId,
        name: '', // имя проставляет сервер
        share,
        baseRevenue,
        baseOrders,
        countsByType: m.countsByType,
        countsByCategory: m.countsByCategory,
        revenueByCategory: m.revenueByCategory,
        sameDayShare: baseOrders > 0 ? sameDay / baseOrders : 0,
        discountMetricValue: m.discountMetricValue,
        qualityAvgScore: m.qualityAvgScore,
        qualityScriptPct: m.qualityScriptPct,
        fastContactShare: m.fastContactShare,
        fieldsFilledShare: m.fieldsFilledShare,
        conversionPct: m.conversion.pct,
        conversionDenominator: m.conversion.denominator,
        dutyShifts: m.dutyShifts,
        grade,
        planTarget,
    };
}

const scaleRec = (rec: Record<string, number>, mult: number, round: boolean) => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(rec)) out[k] = round ? Math.round(rec[k] * mult) : rec[k] * mult;
    return out;
};

/** Построить масштабированные метрики менеджера для фактора s (рост объёма при том же среднем чеке/миксе). */
export function buildScaledMetrics(b: SimManagerBase, s: number): ManagerMetrics {
    const N2 = Math.max(0, Math.round(b.baseOrders * s));
    const targetRev = b.baseRevenue * s;
    const avg = N2 > 0 ? targetRev / N2 : 0;
    const sameDay2 = Math.round(b.sameDayShare * N2);
    const orders: CountedOrder[] = Array.from({ length: N2 }, (_, i) => ({
        orderId: -(i + 1), managerId: b.id, clientId: null, clientName: null, deals: 0,
        type: 'new' as OrderType, category: null,
        enteredAt: '2026-01-15', createdAt: i < sameDay2 ? '2026-01-15' : '2026-01-10',
        totalsumm: avg, goodsBase: avg, discountAmount: 0, discountPct: 0, revenueNoVat: avg, margin: 0,
    }));
    const denom = Math.round(b.conversionDenominator * s);
    return {
        managerId: b.id,
        countedOrders: orders,
        countsByType: { new: Math.round(b.countsByType.new * s), permanent: Math.round(b.countsByType.permanent * s) },
        countsByCategory: scaleRec(b.countsByCategory, s, true),
        revenueByCategory: scaleRec(b.revenueByCategory, s, false),
        discountMetricValue: b.discountMetricValue,
        qualityAvgScore: b.qualityAvgScore,
        qualityScriptPct: b.qualityScriptPct,
        fastContactShare: b.fastContactShare,
        fieldsFilledShare: b.fieldsFilledShare,
        conversion: { numerator: N2, denominator: denom, pct: b.conversionPct, eligible: denom >= 1 },
        dutyShifts: b.dutyShifts,
        workedDays: null,
        marginTotal: 0,
    };
}

export interface SimScenario {
    teamRevenue: number; // выручка отдела (₽, без НДС)
    deptPlan: number; // план отдела (₽) → личный план = deptPlan × share
    businessDays: number;
    year: number;
    month: number;
    baseTeamRevenue: number; // выручка baseline (для фактора масштаба)
}

export interface SimManagerResult { id: number; name: string; total: number; personalRev: number; attainmentPct: number; kTeam: number; gatePass: boolean }
export interface SimResult { perManager: SimManagerResult[]; total: number }

// ============================================================================
// Персональный режим: симулятор ЗП одного менеджера. В отличие от командного
// (масштаб всего отдела фактором выручки) — менеджер/руководитель прямо крутит
// ПОКАЗАТЕЛИ одного человека (число заказов, чек, конверсию, качество…).
// ============================================================================

/** Редактируемые показатели одного менеджера (песочница). Дефолты — из baseline-среза. */
export interface SimManagerInputs {
    ordersNew: number; // число засчитанных новых заявок
    ordersPermanent: number; // число засчитанных заявок постоянных клиентов
    avgCheck: number; // средний чек (выручка без НДС на заказ)
    conversionPct: number; // конверсия, %
    incomingCount: number; // поступивших заявок (знаменатель конверсии / допуск конв-бонуса)
    sameDayShare: number; // доля «в день обращения» (0..1)
    qualityAvgScore: number | null; // средний скоринг ОКК (0..100)
    qualityScriptPct: number | null; // соблюдение скрипта, %
    fastContactShare: number | null; // доля «в работе < 1 дня», %
    fieldsFilledShare: number | null; // доля заполненных ТЗ, %
    discountMetricValue: number | null; // метрика скидочной дисциплины
    dutyShifts: number; // смены дежурств
    grade: number | null; // грейд
}

/** Дефолтные показатели из реального baseline-среза менеджера. */
export function inputsFromBase(b: SimManagerBase): SimManagerInputs {
    const orders = b.baseOrders;
    return {
        ordersNew: b.countsByType?.new ?? 0,
        ordersPermanent: b.countsByType?.permanent ?? 0,
        avgCheck: orders > 0 ? Math.round(b.baseRevenue / orders) : 0,
        conversionPct: Math.round(b.conversionPct),
        incomingCount: b.conversionDenominator,
        sameDayShare: b.sameDayShare,
        qualityAvgScore: b.qualityAvgScore,
        qualityScriptPct: b.qualityScriptPct,
        fastContactShare: b.fastContactShare,
        fieldsFilledShare: b.fieldsFilledShare,
        discountMetricValue: b.discountMetricValue,
        dutyShifts: b.dutyShifts,
        grade: b.grade,
    };
}

/** Построить метрики менеджера из явно заданных показателей (для персонального симулятора). */
export function buildMetricsFromInputs(b: SimManagerBase, inp: SimManagerInputs): ManagerMetrics {
    const N = Math.max(0, Math.round(inp.ordersNew) + Math.round(inp.ordersPermanent));
    const avg = Math.max(0, inp.avgCheck);
    const totalRev = N * avg;
    const sameDay2 = Math.round(Math.max(0, Math.min(1, inp.sameDayShare)) * N);
    const orders: CountedOrder[] = Array.from({ length: N }, (_, i) => ({
        orderId: -(i + 1), managerId: b.id, clientId: null, clientName: null, deals: 0,
        type: 'new' as OrderType, category: null,
        enteredAt: '2026-01-15', createdAt: i < sameDay2 ? '2026-01-15' : '2026-01-10',
        totalsumm: avg, goodsBase: avg, discountAmount: 0, discountPct: 0, revenueNoVat: avg, margin: 0,
    }));
    // Категории: сохраняем baseline-микс, масштабируем числом заказов; выручку нормируем к totalRev.
    const ratio = b.baseOrders > 0 ? N / b.baseOrders : 0;
    const baseCatRevTotal = Object.values(b.revenueByCategory ?? {}).reduce((a, v) => a + v, 0);
    const revByCat: Record<string, number> = {};
    for (const k of Object.keys(b.revenueByCategory ?? {})) {
        revByCat[k] = baseCatRevTotal > 0 ? (b.revenueByCategory[k] / baseCatRevTotal) * totalRev : 0;
    }
    return {
        managerId: b.id,
        countedOrders: orders,
        countsByType: { new: Math.max(0, Math.round(inp.ordersNew)), permanent: Math.max(0, Math.round(inp.ordersPermanent)) },
        countsByCategory: scaleRec(b.countsByCategory ?? {}, ratio, true),
        revenueByCategory: revByCat,
        discountMetricValue: inp.discountMetricValue,
        qualityAvgScore: inp.qualityAvgScore,
        qualityScriptPct: inp.qualityScriptPct,
        fastContactShare: inp.fastContactShare,
        fieldsFilledShare: inp.fieldsFilledShare,
        conversion: { numerator: N, denominator: Math.max(0, Math.round(inp.incomingCount)), pct: inp.conversionPct, eligible: Math.round(inp.incomingCount) >= 1 },
        dutyShifts: Math.max(0, Math.round(inp.dutyShifts)),
        workedDays: null,
        marginTotal: 0,
    };
}

export interface SimManagerScenario {
    teamRevenue: number; // выручка отдела (₽) — контекст для К_команды
    personalPlan: number; // личный план (₽)
    deptPlan: number; // план отдела (₽) — контекст для гейта по плану отдела
    businessDays: number;
    year: number;
    month: number;
}

export interface SimManagerScenarioResult {
    total: number;
    contributions: ComposeResult['contributions'];
    personalRev: number;
    attainmentPct: number;
    kTeam: number;
    gatePass: boolean;
}

/** Пересчитать ЗП одного менеджера при заданных блоках/показателях/сценарии (чистая, мгновенная). */
export function computeManagerScenario(
    blocks: BlockInstance[],
    base: SimManagerBase,
    inputs: SimManagerInputs,
    sc: SimManagerScenario,
): SimManagerScenarioResult {
    const m = buildMetricsFromInputs(base, inputs);
    const personalRev = m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0);
    const ctx: BlockComputeContext = {
        year: sc.year, month: sc.month, businessDays: sc.businessDays,
        teamRevenueNoVat: sc.teamRevenue,
        // -0.01 ₽ снимает float-неоднозначность «ровно на пороге» (att=порог должен проходить гейт)
        personalPlanTarget: sc.personalPlan > 0 ? sc.personalPlan - 0.01 : null,
        departmentPlanTarget: sc.deptPlan > 0 ? sc.deptPlan : null,
        managerGrade: inputs.grade,
        categoryNames: {},
    };
    const composed = compose(blocks, m, ctx);
    const kTeamC = composed.contributions.find((c) => c.code === 'k_team');
    const gateC = composed.contributions.find((c) => c.code === 'plan_gate');
    return {
        total: Math.round(composed.total),
        contributions: composed.contributions,
        personalRev,
        attainmentPct: sc.personalPlan > 0 ? (personalRev / sc.personalPlan) * 100 : 0,
        kTeam: kTeamC?.multiplier ?? 1,
        gatePass: (gateC?.multiplier ?? 1) > 0,
    };
}

/** Пересчитать ФОТ при заданных блоках и сценарии (чистая, мгновенная — для ползунков). */
export function computeScenarioFot(blocks: BlockInstance[], bases: SimManagerBase[], sc: SimScenario): SimResult {
    const s = sc.baseTeamRevenue > 0 ? sc.teamRevenue / sc.baseTeamRevenue : 1;
    const perManager: SimManagerResult[] = [];
    let total = 0;
    for (const b of bases) {
        const m = buildScaledMetrics(b, s);
        const personalRev = m.countedOrders.reduce((a, o) => a + o.revenueNoVat, 0);
        const planTarget = sc.deptPlan > 0 ? sc.deptPlan * b.share : 0;
        const ctx: BlockComputeContext = {
            year: sc.year, month: sc.month, businessDays: sc.businessDays,
            teamRevenueNoVat: sc.teamRevenue,
            // -0.01 ₽ снимает float-неоднозначность «ровно на пороге» (att=порог должен проходить гейт)
            personalPlanTarget: planTarget > 0 ? planTarget - 0.01 : null,
            departmentPlanTarget: sc.deptPlan > 0 ? sc.deptPlan : null,
            managerGrade: b.grade,
            categoryNames: {},
        };
        const composed = compose(blocks, m, ctx);
        const kTeamC = composed.contributions.find((c) => c.code === 'k_team');
        const gateC = composed.contributions.find((c) => c.code === 'plan_gate');
        perManager.push({
            id: b.id, name: b.name, total: composed.total, personalRev,
            attainmentPct: planTarget > 0 ? (personalRev / planTarget) * 100 : 0,
            kTeam: kTeamC?.multiplier ?? 1,
            gatePass: (gateC?.multiplier ?? 1) > 0,
        });
        total += composed.total;
    }
    return { perManager, total: Math.round(total) };
}
