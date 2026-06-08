import { supabase } from '@/utils/supabase';
import { getConfigForPeriod, type SalaryConfig } from '@/lib/salary/config';
import { collectPeriodMetrics, type ManagerMetrics, type PeriodMetrics } from '@/lib/salary/metrics';

// ============================================================================
// Движок расчёта ЗП. Берёт сырые метрики + конфиг-тиры, считает по формуле:
//   ЗП = Оклад + [(Премия_за_заявки × К_качества) + Конв_бонус + Скидка_бонус] × К_команды + Дежурства
// Порядок: К_качества множит ТОЛЬКО премию за заявки; К_команды — всю переменную
// часть; оклад и дежурства не режутся. Все ставки/тиры — из конфига (ноль хардкода).
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

type Tier = { min: number };

/** Тир по значению: берём тир с наибольшим min, который <= value. */
export function pickTier<T extends Tier>(value: number, tiers: T[]): T | null {
    const sorted = [...tiers].sort((a, b) => b.min - a.min);
    for (const t of sorted) {
        if (value >= t.min) return t;
    }
    return null;
}

/** Кол-во рабочих дней (Пн–Пт) в месяце — для пропорции оклада. Не хардкод-число, а календарь. */
export function businessDaysInMonth(year: number, month: number): number {
    let count = 0;
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count;
}

function passesDiscount(value: number | null, cfg: SalaryConfig['discount_bonus']): boolean {
    if (value == null) return false;
    return cfg.comparator === 'lte' ? value <= cfg.threshold : value >= cfg.threshold;
}

/** Расчёт по одному менеджеру (чистая функция). kTeam передаётся снаружи (общий по отделу). */
export function computeManagerSalary(
    m: ManagerMetrics,
    config: SalaryConfig,
    kTeam: number,
    businessDays: number,
): SalaryResult {
    // Премия за заявки
    const rates = config.rate_zayavka;
    const premiaZayavki =
        m.countsByType.new * rates.new +
        m.countsByType.permanent * rates.permanent +
        m.countsByType.pech_vto * rates.pech_vto;

    // К_качества (множит только премию). Нет оценок → нейтральный 1.0 (не штрафуем за отсутствие данных).
    const kQuality = m.qualityAvgScore == null ? 1 : pickTier(m.qualityAvgScore, config.k_quality_tiers)?.k ?? 1;

    // Конв-бонус (только при допуске по минимуму заявок)
    const convBonus = m.conversion.eligible ? pickTier(m.conversion.pct, config.conv_bonus_tiers)?.bonus ?? 0 : 0;

    // Бонус за скидочную дисциплину
    const discountPassed = passesDiscount(m.discountMetricValue, config.discount_bonus);
    const discountBonus = discountPassed ? config.discount_bonus.bonus : 0;

    // Оклад с пропорцией по отработанным дням (полный, если табель не вёлся)
    const okladProration = m.workedDays == null || businessDays <= 0 ? 1 : Math.min(1, m.workedDays / businessDays);
    const oklad = config.oklad * okladProration;

    // Дежурства (не режутся К_команды)
    const dutyPay = m.dutyShifts * config.duty_rate;

    // Переменная часть × К_команды
    const variablePart = (premiaZayavki * kQuality + convBonus + discountBonus) * kTeam;

    const total = oklad + variablePart + dutyPay;

    return {
        managerId: m.managerId,
        oklad: round2(oklad),
        premiaZayavki: round2(premiaZayavki),
        kQuality,
        convBonus: round2(convBonus),
        discountBonus: round2(discountBonus),
        dutyPay: round2(dutyPay),
        kTeam,
        total: round2(total),
        marginInfo: round2(m.marginTotal),
        breakdown: {
            counts: m.countsByType,
            rates,
            qualityScore: m.qualityAvgScore,
            conversionPct: round2(m.conversion.pct),
            conversionEligible: m.conversion.eligible,
            conversionNumerator: m.conversion.numerator,
            conversionDenominator: m.conversion.denominator,
            discountMetric: config.discount_bonus.metric,
            discountValue: m.discountMetricValue == null ? null : round2(m.discountMetricValue),
            discountPassed,
            teamRevenueNoVat: round2(m.countedOrders.reduce((s, o) => s + o.revenueNoVat, 0)),
            workedDays: m.workedDays,
            okladProration: round2(okladProration),
            variablePart: round2(variablePart),
            countedOrderIds: m.countedOrders.map((o) => o.orderId),
        },
    };
}

/** Расчёт по всему периоду (чистая функция над метриками). */
export function computePeriodSalary(pm: PeriodMetrics, config: SalaryConfig): PeriodSalary {
    const kTeam = pickTier(pm.teamRevenueNoVat, config.k_team_tiers)?.k ?? 1;
    const businessDays = businessDaysInMonth(pm.year, pm.month);
    const results = pm.managers.map((m) => computeManagerSalary(m, config, kTeam, businessDays));
    return { year: pm.year, month: pm.month, teamRevenueNoVat: pm.teamRevenueNoVat, kTeam, results };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

// ── Оркестратор + персистентность ───────────────────────────────────────────

/** Считает период из боевых данных (метрики → формула). Без записи в БД. */
export async function calculatePeriod(year: number, month: number): Promise<PeriodSalary> {
    const config = await getConfigForPeriod(year, month);
    const metrics = await collectPeriodMetrics(year, month, config);
    return computePeriodSalary(metrics, config);
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
