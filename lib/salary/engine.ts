import { supabase } from '@/utils/supabase';
import { getConfigForPeriod, type SalaryConfig } from '@/lib/salary/config';
import { collectPeriodMetrics, type ManagerMetrics, type OrderType, type PeriodMetrics } from '@/lib/salary/metrics';
import { compose } from '@/lib/salary/blocks/compose';
import { pickTier, round2 } from '@/lib/salary/blocks/tiers';
import { getPlansForPeriod, resolveManagerComp, type PeriodPlans } from '@/lib/salary/schemes';
import type { BlockComputeContext, BlockContribution, BlockInstance } from '@/lib/salary/blocks/types';

export { pickTier }; // обратная совместимость со старыми импортами

/** Краткая карточка засчитанного заказа для отчёта по менеджеру (номер кликабелен в UI). */
export interface CountedOrderBrief {
    id: number;
    type: OrderType;
    sum: number; // сумма заказа
    revenueNoVat: number; // выручка без НДС (идёт в К_команды)
    discountPct: number; // % скидки по заказу
    enteredAt: string; // дата передачи в производство
}

// ============================================================================
// Движок расчёта ЗП. Теперь ЗП = сумма вкладов назначенных менеджеру БЛОКОВ
// (см. lib/salary/blocks). Под пресетом «Продавец» это тождественно прежней
// формуле: Оклад + [(Премия×К_кач) + Конв + Скидка] × К_команды + Дежурства.
// Реестр ОП = менеджеры с назначенной схемой (salary_manager_comp). Числа — в БД.
// ============================================================================

export interface SalaryBreakdown {
    counts: ManagerMetrics['countsByType'];
    rates: SalaryConfig['rate_zayavka'];
    qualityScore: number | null;
    conversionPct: number;
    conversionEligible: boolean;
    conversionNumerator: number;
    conversionDenominator: number;
    discountMetric: string;
    discountValue: number | null;
    discountPassed: boolean;
    teamRevenueNoVat: number;
    workedDays: number | null;
    okladProration: number;
    variablePart: number;
    countedOrderIds: number[];
    countedOrders: CountedOrderBrief[]; // детализация по каждому засчитанному заказу
    schemeCode?: string; // назначенная схема (роль)
    blockContributions?: BlockContribution[]; // вклад каждого блока (для отчёта/экспорта)
}

export interface SalaryResult {
    managerId: number;
    oklad: number;
    premiaZayavki: number;
    kQuality: number;
    convBonus: number;
    discountBonus: number;
    dutyPay: number;
    kTeam: number;
    total: number;
    marginInfo: number;
    breakdown: SalaryBreakdown;
}

export interface PeriodSalary {
    year: number;
    month: number;
    teamRevenueNoVat: number;
    kTeam: number;
    results: SalaryResult[];
}

/** Кол-во рабочих дней (Пн–Пт) в месяце — для пропорции оклада. */
export function businessDaysInMonth(year: number, month: number): number {
    let count = 0;
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count;
}

/** Пустые метрики для менеджера из реестра без активности (оператор → только оклад). */
function zeroMetrics(managerId: number): ManagerMetrics {
    return {
        managerId,
        countedOrders: [],
        countsByType: { new: 0, permanent: 0, pech_vto: 0 },
        discountMetricValue: null,
        qualityAvgScore: null,
        conversion: { numerator: 0, denominator: 0, pct: 0, eligible: false },
        dutyShifts: 0,
        workedDays: null,
        marginTotal: 0,
    };
}

/**
 * Расчёт по одному менеджеру: компонуем его блоки, маппим вклады обратно в
 * legacy-колонки salary_calc (для совместимости дашборда/экспорта) и кладём
 * детальный вклад каждого блока в breakdown.blockContributions.
 */
export function computeManagerSalary(
    m: ManagerMetrics,
    blockInstances: BlockInstance[],
    ctx: BlockComputeContext,
    schemeCode?: string,
): SalaryResult {
    const composed = compose(blockInstances, m, ctx);
    const byCode = new Map(composed.contributions.map((c) => [c.code, c]));

    const kQuality = byCode.get('k_quality')?.multiplier ?? 1;
    const kTeam = byCode.get('k_team')?.multiplier ?? 1;
    const premia = byCode.get('premia_zayavki')?.amount ?? 0;
    const convBonus = byCode.get('conv_bonus')?.amount ?? 0;
    const discountBonus = byCode.get('discount_bonus')?.amount ?? 0;

    // Параметры для совместимых полей breakdown (ставки/метрика скидки) — из назначенных блоков.
    const premiaInst = blockInstances.find((b) => b.code === 'premia_zayavki');
    const rates = (premiaInst?.params?.rates as SalaryConfig['rate_zayavka']) ?? { new: 0, permanent: 0, pech_vto: 0 };
    const discountInst = blockInstances.find((b) => b.code === 'discount_bonus');
    const discountMetric = (discountInst?.params?.metric as string) ?? '';

    const okladProration = m.workedDays == null || ctx.businessDays <= 0 ? 1 : Math.min(1, m.workedDays / ctx.businessDays);

    return {
        managerId: m.managerId,
        oklad: round2(composed.base),
        premiaZayavki: round2(premia),
        kQuality,
        convBonus: round2(convBonus),
        discountBonus: round2(discountBonus),
        dutyPay: round2(composed.duty),
        kTeam,
        total: round2(composed.total),
        marginInfo: round2(m.marginTotal),
        breakdown: {
            counts: m.countsByType,
            rates,
            qualityScore: m.qualityAvgScore,
            conversionPct: round2(m.conversion.pct),
            conversionEligible: m.conversion.eligible,
            conversionNumerator: m.conversion.numerator,
            conversionDenominator: m.conversion.denominator,
            discountMetric,
            discountValue: m.discountMetricValue == null ? null : round2(m.discountMetricValue),
            discountPassed: discountBonus > 0,
            teamRevenueNoVat: round2(m.countedOrders.reduce((s, o) => s + o.revenueNoVat, 0)),
            workedDays: m.workedDays,
            okladProration: round2(okladProration),
            variablePart: composed.variablePart,
            countedOrderIds: m.countedOrders.map((o) => o.orderId),
            countedOrders: m.countedOrders.map((o) => ({
                id: o.orderId,
                type: o.type,
                sum: round2(o.totalsumm),
                revenueNoVat: round2(o.revenueNoVat),
                discountPct: round2(o.discountPct),
                enteredAt: o.enteredAt,
            })),
            schemeCode,
            blockContributions: composed.contributions,
        },
    };
}

/** Расчёт периода: только менеджеры из реестра (с назначенной схемой). */
export function computePeriodSalary(
    pm: PeriodMetrics,
    compMap: Map<number, { schemeCode: string; blocks: BlockInstance[] }>,
    plans: PeriodPlans,
    config: SalaryConfig,
): PeriodSalary {
    const businessDays = businessDaysInMonth(pm.year, pm.month);
    const teamRevenueNoVat = pm.teamRevenueNoVat;
    const kTeam = pickTier(teamRevenueNoVat, config.k_team_tiers)?.k ?? 1;

    const metricsById = new Map(pm.managers.map((m) => [m.managerId, m]));
    const results: SalaryResult[] = [];
    for (const [managerId, comp] of Array.from(compMap)) {
        const m = metricsById.get(managerId) ?? zeroMetrics(managerId);
        const ctx: BlockComputeContext = {
            year: pm.year,
            month: pm.month,
            businessDays,
            teamRevenueNoVat,
            personalPlanTarget: plans.personal.get(managerId) ?? null,
            departmentPlanTarget: plans.department,
        };
        results.push(computeManagerSalary(m, comp.blocks, ctx, comp.schemeCode));
    }
    results.sort((a, b) => a.managerId - b.managerId);
    return { year: pm.year, month: pm.month, teamRevenueNoVat, kTeam, results };
}

// ── Оркестратор + персистентность ───────────────────────────────────────────

/** Считает период из боевых данных (метрики → схемы/планы → блоки). Без записи. */
export async function calculatePeriod(year: number, month: number): Promise<PeriodSalary> {
    const config = await getConfigForPeriod(year, month);
    const metrics = await collectPeriodMetrics(year, month, config);
    const asOf = `${year}-${String(month).padStart(2, '0')}-01`;
    const compMap = await resolveManagerComp(asOf);
    const plans = await getPlansForPeriod(year, month);
    return computePeriodSalary(metrics, compMap, plans, config);
}

/** Get-or-create открытого периода. Бросает, если период закрыт. */
async function ensureOpenPeriod(year: number, month: number): Promise<number> {
    const { data: existing } = await supabase
        .from('salary_period')
        .select('id,status')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();

    if (existing) {
        if (existing.status === 'closed') {
            throw new Error(`Период ${year}-${month} закрыт. Правки — только через корректировки.`);
        }
        return existing.id;
    }
    const { data: created, error } = await supabase
        .from('salary_period')
        .insert({ year, month, status: 'open' })
        .select('id')
        .single();
    if (error) throw error;
    return created.id;
}

/** Считает и СОХРАНЯЕТ расчёт периода в salary_calc (+ аудит). Период должен быть открыт. */
export async function recalcAndPersist(year: number, month: number, actor: string | null): Promise<PeriodSalary> {
    const periodId = await ensureOpenPeriod(year, month);
    const calc = await calculatePeriod(year, month);

    const rows = calc.results.map((r) => ({
        period_id: periodId,
        manager_id: r.managerId,
        oklad: r.oklad,
        premia_zayavki: r.premiaZayavki,
        k_quality: r.kQuality,
        conv_bonus: r.convBonus,
        discount_bonus: r.discountBonus,
        duty_pay: r.dutyPay,
        k_team: r.kTeam,
        total: r.total,
        margin_info: r.marginInfo,
        breakdown: r.breakdown,
        computed_at: new Date().toISOString(),
    }));

    if (rows.length) {
        const { error } = await supabase.from('salary_calc').upsert(rows, { onConflict: 'period_id,manager_id' });
        if (error) throw error;
    }

    // Удаляем устаревшие строки (менеджеры, выбывшие из реестра) — только для открытого периода.
    const keepIds = rows.map((r) => r.manager_id);
    let del = supabase.from('salary_calc').delete().eq('period_id', periodId);
    if (keepIds.length) del = del.not('manager_id', 'in', `(${keepIds.join(',')})`);
    const { error: delErr } = await del;
    if (delErr) throw delErr;

    await supabase.from('salary_audit_log').insert({
        entity: 'calc',
        entity_id: String(periodId),
        action: 'recalc',
        actor,
        old_value: null,
        new_value: { year, month, managers: rows.length, teamRevenueNoVat: calc.teamRevenueNoVat, kTeam: calc.kTeam },
    });

    return calc;
}
