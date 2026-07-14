import { supabase } from '@/utils/supabase';
import { businessDaysInMonth } from '@/lib/salary/engine';
import { pickTier } from '@/lib/salary/blocks/tiers';
import { getPlansForPeriod, resolveManagerComp } from '@/lib/salary/schemes';
import { getPrepayPolicy } from '@/lib/salary/config';
import { isBankSyncExternalId } from '@/lib/payments/types';
import { resolveManagerGrades, resolveGradePolicy } from '@/lib/salary/grades';
import type { BlockContribution } from '@/lib/salary/blocks/types';

// ============================================================================
// Сборка «приборной панели» для личного кабинета менеджера (/salary/my).
// Только существующие данные: план и факт из расчёта периода, тиры/ставки —
// из назначенной схемы (БД), пороговые метрики — из okk_order_scores, оплаты —
// из orders.raw_payload.payments. Никаких зашитых чисел: пороги/ставки — из схемы
// и конфига. Считается поверх сохранённого расчёта (salary_calc) — без пересчёта движка.
// ============================================================================

const round = (n: number) => Math.round(Number(n) || 0);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Ближайшая вверх ступень, которая реально ПОВЫШАЕТ коэффициент (k > текущего):
// пропускаем промежуточные тиры с тем же k (иначе «рубеж» дал бы +0 ₽).
function nextRewardTier(value: number, curK: number, tiers: { min: number; k: number }[]): { min: number; k: number } | null {
    const better = tiers.filter((t) => t.min > value && t.k > curK).sort((a, b) => a.min - b.min);
    return better[0] ?? null;
}

export interface MyDashboard {
    plan: {
        personalTarget: number | null;
        personalFact: number;
        personalPct: number | null;
        personalRemaining: number | null;
        deptTarget: number | null;
        deptFact: number;
        deptPct: number | null;
    };
    pace: {
        isCurrentMonth: boolean;
        businessDaysTotal: number;
        businessDaysElapsed: number;
        businessDaysLeft: number;
        calendarDaysLeft: number;
        factPerDay: number;
        requiredPerDay: number | null; // null — плана нет
        expectedPct: number; // ожидаемый % линейного темпа к сегодня (метка на полосе)
    };
    prepay: {
        available: boolean; // политика настроена
        thresholdPct: number | null;
        paid: number;
        base: number;
        pct: number | null;
        passed: boolean | null;
    };
    okk: {
        personal: number | null; // средний % скоринга менеджера (как на дашборде ОКК)
        department: number | null; // средний % по ОП
    };
    conversion: {
        personalPct: number | null;
        numerator: number;
        denominator: number;
        departmentPct: number | null; // конверсия всего ОП за период (Σ числ / Σ знам)
    };
    milestones: Milestone[];
    thresholds: Threshold[];
    grade: GradeInfo | null;
    permanentThreshold: number | null; // порог сделок для «постоянного» клиента (для подписи в строках)
}

export interface Milestone {
    code: string;
    title: string;
    unit: 'rub' | 'orders';
    need: number; // сколько добрать (₽ выручки или шт.)
    progressPct: number; // для полоски (0..100)
    gain: number; // прибавка к ЗП, ₽ (точная)
    note: string;
}

export interface Threshold {
    code: string;
    name: string;
    hint: string;
    value: number | null; // текущее значение метрики (%), null — нет данных
    threshold: number; // порог
    passed: boolean;
    gain: number; // ₽ за достижение (0, если уже выполнен, тогда gain = активный бонус)
    active: number; // ₽ уже активного бонуса (для выполненных)
}

export interface GradeInfo {
    level: number;
    floor: number;
    top: number;
    streak: number; // месяцев выполнения подряд
    promoteAfter: number;
    monthsToPromote: number | null; // null — уже на верхнем уровне
}

type ContribList = BlockContribution[];

const sumMult = (cs: ContribList, scope: string, exceptCode?: string) =>
    cs.filter((c) => c.kind === 'multiplier' && c.multiplierScope === scope && c.code !== exceptCode)
        .reduce((p, c) => p * (c.multiplier ?? 1), 1);
const sumAdditive = (cs: ContribList, group: string) =>
    cs.filter((c) => c.kind !== 'multiplier' && c.kind !== 'penalty' && c.group === group)
        .reduce((s, c) => s + (c.amount || 0), 0);
const findMult = (cs: ContribList, code: string) => cs.find((c) => c.code === code)?.multiplier ?? null;

function monthBounds(year: number, month: number): { start: string; end: string } {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    return { start, end };
}

function businessDaysUpTo(year: number, month: number, day: number): number {
    let n = 0;
    for (let d = 1; d <= day; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        if (dow !== 0 && dow !== 6) n++;
    }
    return n;
}

/** Собирает панель менеджера поверх сохранённой строки расчёта (row). */
export async function buildMyDashboard(params: {
    year: number;
    month: number;
    managerId: number;
    row: any | null;
    teamRevenueNoVat: number; // истинная выручка отдела за период (Σ по всем строкам, buildTeamOrders)
    periodId: number; // для конверсии отдела (Σ по всем строкам периода)
}): Promise<MyDashboard> {
    const { year, month, managerId, row, teamRevenueNoVat, periodId } = params;
    const asOf = `${year}-${String(month).padStart(2, '0')}-01`;
    const b = row?.breakdown ?? {};
    const contribs: ContribList = Array.isArray(b.blockContributions) ? b.blockContributions : [];
    const hasContribs = contribs.length > 0;

    const countedOrders: any[] = Array.isArray(b.countedOrders) ? b.countedOrders : [];
    const countedOrderIds: number[] = Array.isArray(b.countedOrderIds)
        ? b.countedOrderIds
        : countedOrders.map((o) => Number(o.id)).filter(Boolean);
    const personalFact = countedOrders.reduce((s, o) => s + (Number(o.revenueNoVat) || 0), 0);
    // Факт отдела — сумма выручки всех менеджеров периода (buildTeamOrders), а НЕ
    // breakdown.teamRevenueNoVat строки: в открытом периоде она по строке = личный факт.
    const deptFact = Number(teamRevenueNoVat) || 0;

    // ── Планы ────────────────────────────────────────────────────────────────
    const plans = await getPlansForPeriod(year, month);
    const personalTarget = plans.personal.get(managerId) ?? null;
    const deptTarget = plans.department;
    const personalPct = personalTarget && personalTarget > 0 ? round2((personalFact / personalTarget) * 100) : null;
    const deptPct = deptTarget && deptTarget > 0 ? round2((deptFact / deptTarget) * 100) : null;
    const personalRemaining = personalTarget != null ? Math.max(0, round(personalTarget - personalFact)) : null;

    // ── Темп ─────────────────────────────────────────────────────────────────
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
    const daysInMonth = new Date(year, month, 0).getDate();
    const businessDaysTotal = businessDaysInMonth(year, month);
    const today = isCurrentMonth ? now.getDate() : daysInMonth;
    const businessDaysElapsed = isCurrentMonth ? businessDaysUpTo(year, month, today) : businessDaysTotal;
    const businessDaysLeft = Math.max(0, businessDaysTotal - businessDaysElapsed);
    const calendarDaysLeft = isCurrentMonth ? Math.max(0, daysInMonth - today) : 0;
    const factPerDay = businessDaysElapsed > 0 ? round(personalFact / businessDaysElapsed) : 0;
    const requiredPerDay =
        personalRemaining != null ? (businessDaysLeft > 0 ? round(personalRemaining / businessDaysLeft) : 0) : null;
    const expectedPct = businessDaysTotal > 0 ? round2((businessDaysElapsed / businessDaysTotal) * 100) : 0;

    // ── Предоплата (фактически оплачено по засчитанным заказам) ────────────────
    const prepay = await computePrepay(countedOrderIds, countedOrders, asOf);

    // Порог «постоянного» клиента (для подписи типа в строках заказов)
    const permanentThreshold = await getPermanentThreshold(asOf);

    // ── Скоринг ОКК: личный + отдела (та же формула, что дашборд ОКК) ───────────
    const okk = await computeOkkScoring(managerId);

    // ── Конверсия: личная (из расчёта) + отдела (Σ по всем строкам периода) ──────
    const convNum = Number(b.conversionNumerator) || 0;
    const convDenom = Number(b.conversionDenominator) || 0;
    const conversion = {
        personalPct: convDenom > 0 ? round2(b.conversionPct != null ? Number(b.conversionPct) : (convNum / convDenom) * 100) : null,
        numerator: convNum,
        denominator: convDenom,
        departmentPct: await computeDeptConversion(periodId),
    };

    // ── Схема (тиры/ставки блоков) ─────────────────────────────────────────────
    const comp = (await resolveManagerComp(asOf)).get(managerId) ?? null;
    const paramsByCode = new Map<string, any>();
    for (const bl of comp?.blocks ?? []) paramsByCode.set(bl.code, bl.params ?? {});

    const variablePart = Number(b.variablePart) || 0;
    const premiaBase = sumAdditive(contribs, 'premia');
    const variableBase = sumAdditive(contribs, 'variable');
    const mPremia = sumMult(contribs, 'premia');
    const mTeam = sumMult(contribs, 'variableBracket');
    const premiaAfter = premiaBase * mPremia;

    const milestones: Milestone[] = [];
    const thresholds: Threshold[] = [];

    if (hasContribs) {
        // Рубеж: коэффициент по личному плану (variableBracket)
        const planTiers = paramsByCode.get('plan_coef')?.tiers as { min: number; k: number }[] | undefined;
        if (planTiers && personalTarget && personalTarget > 0) {
            const att = (personalFact / personalTarget) * 100;
            const kOld = findMult(contribs, 'plan_coef') ?? pickTier(att, planTiers)?.k ?? 1;
            const nt = nextRewardTier(att, kOld, planTiers);
            if (nt) {
                const need = Math.max(0, round(personalTarget * (nt.min / 100) - personalFact));
                const mOthers = sumMult(contribs, 'variableBracket', 'plan_coef');
                const gain = round((premiaAfter + variableBase) * mOthers * (nt.k - kOld));
                if (gain > 0)
                    milestones.push({
                        code: 'plan_coef',
                        title: `Личный план ${Math.round(nt.min)}% → коэффициент ×${nt.k}`,
                        unit: 'rub',
                        need,
                        progressPct: Math.min(100, round2((att / nt.min) * 100)),
                        gain,
                        note: `Ещё ${fmt(need)} ₽ выручки (сейчас ×${round2(kOld)})`,
                    });
            }
        }

        // Рубеж: коэффициент по плану отдела / К_команды (variableBracket, на выручке отдела)
        for (const code of ['k_team', 'dept_plan_coef']) {
            const tiers = paramsByCode.get(code)?.tiers as { min: number; k: number }[] | undefined;
            if (!tiers) continue;
            const metric = code === 'dept_plan_coef' && deptTarget && deptTarget > 0 ? (deptFact / deptTarget) * 100 : deptFact;
            const kOld = findMult(contribs, code) ?? pickTier(metric, tiers)?.k ?? 1;
            const nt = nextRewardTier(metric, kOld, tiers);
            if (!nt) continue;
            const need =
                code === 'dept_plan_coef' && deptTarget
                    ? Math.max(0, round(deptTarget * (nt.min / 100) - deptFact))
                    : Math.max(0, round(nt.min - deptFact));
            const mOthers = sumMult(contribs, 'variableBracket', code);
            const gain = round((premiaAfter + variableBase) * mOthers * (nt.k - kOld));
            if (gain > 0)
                milestones.push({
                    code,
                    title: code === 'k_team' ? `Следующая ступень К_команды ×${nt.k}` : `План отдела ${Math.round(nt.min)}% → ×${nt.k}`,
                    unit: 'rub',
                    need,
                    progressPct: Math.min(100, round2((metric / nt.min) * 100)),
                    gain,
                    note: `Отделу ещё ${fmt(need)} ₽ выручки (сейчас ×${round2(kOld)})`,
                });
        }

        // Рубеж: ценность одной новой заявки (премия × К_качества × переменные множители)
        const rates = b.rates ?? paramsByCode.get('premia_zayavki')?.rates;
        if (rates && Number(rates.new) > 0) {
            const perOrder = round(Number(rates.new) * mPremia * mTeam);
            if (perOrder > 0)
                milestones.push({
                    code: 'premia_zayavki',
                    title: 'Каждая новая заявка',
                    unit: 'orders',
                    need: 1,
                    progressPct: 0,
                    gain: perOrder,
                    note: `Премия за нового клиента с учётом К_качества и множителей`,
                });
        }

        // Пороговые: К_качества (premia-множитель) — до следующего тира
        const qTiers = paramsByCode.get('k_quality')?.tiers as { min: number; k: number }[] | undefined;
        const qScore = b.qualityScore != null ? Number(b.qualityScore) : null;
        if (qTiers && qScore != null) {
            const kOld = findMult(contribs, 'k_quality') ?? pickTier(qScore, qTiers)?.k ?? 1;
            const nt = nextRewardTier(qScore, kOld, qTiers);
            if (nt) {
                const mPremiaOthers = sumMult(contribs, 'premia', 'k_quality');
                const gain = round(premiaBase * mPremiaOthers * (nt.k - kOld) * mTeam);
                thresholds.push({
                    code: 'k_quality',
                    name: 'К_качества (ОКК-скоринг)',
                    hint: 'средняя оценка качества заказов',
                    value: round(qScore),
                    threshold: nt.min,
                    passed: false,
                    gain: Math.max(0, gain),
                    active: 0,
                });
            }
        }

        // Пороговые бонусы качества/дисциплины (только блоки из схемы)
        const okk = await loadOkkMetrics(managerId, year, month);
        const bonusRows: { code: string; name: string; hint: string; value: number | null }[] = [
            { code: 'script_bonus', name: 'Соблюдение скрипта', hint: 'средняя оценка по звонкам', value: okk.script },
            { code: 'fast_contact_bonus', name: 'Скорость первого контакта', hint: 'доля заявок в работе < 1 дня', value: okk.fast },
            { code: 'fields_bonus', name: 'Заполнение ТЗ', hint: 'доля заказов с полученным ТЗ', value: okk.fields },
        ];
        for (const r of bonusRows) {
            const p = paramsByCode.get(r.code);
            if (!p) continue; // блока нет в схеме → бонуса не существует, не показываем
            const threshold = Number(p.thresholdPct);
            const bonus = Number(p.bonus) || 0;
            const passed = r.value != null && r.value >= threshold;
            thresholds.push({
                code: r.code,
                name: r.name,
                hint: r.hint,
                value: r.value != null ? round(r.value) : null,
                threshold,
                passed,
                gain: passed ? 0 : bonus,
                active: passed ? bonus : 0,
            });
        }
    }

    // ── Грейд (только если схема использует grade_multiplier) ───────────────────
    let grade: GradeInfo | null = null;
    if (paramsByCode.has('grade_multiplier')) {
        grade = await buildGrade(managerId, asOf);
    }

    return {
        plan: {
            personalTarget,
            personalFact: round(personalFact),
            personalPct,
            personalRemaining,
            deptTarget,
            deptFact: round(deptFact),
            deptPct,
        },
        pace: {
            isCurrentMonth,
            businessDaysTotal,
            businessDaysElapsed,
            businessDaysLeft,
            calendarDaysLeft,
            factPerDay,
            requiredPerDay,
            expectedPct,
        },
        prepay,
        okk,
        conversion,
        milestones,
        thresholds,
        grade,
        permanentThreshold,
    };
}

/** Порог сделок для «постоянного» клиента на дату (salary_config). null — не задан. */
async function getPermanentThreshold(asOf: string): Promise<number | null> {
    const { data } = await supabase
        .from('salary_config')
        .select('value')
        .eq('key', 'permanent_client_threshold')
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false })
        .limit(1);
    const v = data?.[0]?.value;
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

/** Конверсия всего ОП за период: Σ числителей / Σ знаменателей по строкам расчёта. */
async function computeDeptConversion(periodId: number): Promise<number | null> {
    const { data } = await supabase.from('salary_calc').select('breakdown').eq('period_id', periodId);
    let num = 0;
    let denom = 0;
    for (const r of (data as any[]) ?? []) {
        num += Number(r.breakdown?.conversionNumerator) || 0;
        denom += Number(r.breakdown?.conversionDenominator) || 0;
    }
    return denom > 0 ? round2((num / denom) * 100) : null;
}

/**
 * Средний % скоринга ОКК менеджера и всего ОП — идентично дашборду ОКК
 * (app/api/okk/scores): Math.round(AVG(deal_score_pct)). Личный — по заказам
 * менеджера в рабочих статусах (status_settings.is_working, order_id < 99900000);
 * отдела — по всем оценкам. Без фильтра по периоду, как и на дашборде ОКК.
 */
async function computeOkkScoring(managerId: number): Promise<MyDashboard['okk']> {
    const avg = (rows: any[] | null) => {
        const vals = (rows ?? []).map((s) => Number(s.deal_score_pct)).filter((v) => Number.isFinite(v));
        return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    };

    // Отдел: все оценки с непустым deal_score_pct
    const { data: allScores } = await supabase
        .from('okk_order_scores')
        .select('deal_score_pct')
        .not('deal_score_pct', 'is', null);
    const department = avg(allScores as any[]);

    // Личный: заказы менеджера в рабочих статусах → их оценки
    const { data: settings } = await supabase.from('status_settings').select('code').eq('is_working', true);
    const workingStatuses = ((settings as any[]) ?? []).map((s) => s.code);
    let personal: number | null = null;
    if (workingStatuses.length) {
        const { data: mgrOrders } = await supabase
            .from('orders')
            .select('order_id')
            .in('status', workingStatuses)
            .lt('order_id', 99900000)
            .eq('manager_id', managerId);
        const ids = ((mgrOrders as any[]) ?? []).map((o) => o.order_id);
        if (ids.length) {
            const { data: scores } = await supabase
                .from('okk_order_scores')
                .select('deal_score_pct')
                .in('order_id', ids)
                .not('deal_score_pct', 'is', null);
            personal = avg(scores as any[]);
        }
    }
    return { personal, department };
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString('ru-RU');
}

/**
 * Средний % предоплаты по ЗАСЧИТАННЫМ заказам. Взнос считается ПОЗАКАЗНО и
 * ограничен суммой заказа (min(оплачено, сумма)) — предоплата по заказу не бывает
 * >100% (защита от переплат и двойного учёта: счёт + перевод на ту же сумму).
 * Оплата = payments[status ∈ paid_statuses]. Итог = Σ min(оплата, сумма) / Σ сумма.
 */
async function computePrepay(
    orderIds: number[],
    countedOrders: any[],
    asOf: string,
): Promise<MyDashboard['prepay']> {
    const policy = await getPrepayPolicy(asOf);
    // Всё считаем БЕЗ НДС — как и план. Знаменатель = выручка без НДС; оплату (приходит
    // с НДС) приводим к без-НДС той же пропорцией заказа (revenueNoVat/sum). Процент при
    // этом не меняется (числитель и знаменатель делятся на один НДС), но рубли — без НДС.
    const noVatById = new Map<number, number>();
    const grossById = new Map<number, number>();
    for (const o of countedOrders) {
        noVatById.set(Number(o.id), Number(o.revenueNoVat) || 0);
        grossById.set(Number(o.id), Number(o.sum) || 0);
    }
    const base = countedOrders.reduce((s, o) => s + (Number(o.revenueNoVat) || 0), 0);
    if (!policy || orderIds.length === 0) {
        return { available: !!policy, thresholdPct: policy?.threshold_pct ?? null, paid: 0, base: round(base), pct: null, passed: null };
    }
    const paidSet = new Set(policy.paid_statuses);
    const invoiceTypes = new Set(policy.invoice_types ?? ['invoicejur', 'invoicefiz']);
    const { data, error } = await supabase.from('orders').select('order_id,raw_payload').in('order_id', orderIds);
    if (error) throw error;
    let paid = 0;
    for (const o of (data as any[]) ?? []) {
        const payments = o?.raw_payload?.payments;
        if (!payments || typeof payments !== 'object') continue;
        // Фактический приход = наши банк-синк-платежи (по externalId tochka-/tbank-); счёт,
        // выставленный менеджером (invoice-тип без нашего externalId) — фолбэк, если прихода нет.
        // Так снимается задвоение «счёт + банковский платёж» на ту же сумму. Признак — externalId,
        // а не тип оплаты: наши платежи теперь идут типом invoicejur (как и счёт), различить можно
        // только по externalId. Прочие не-invoice поступления (напр. наличные) тоже считаем приходом.
        let receipts = 0;
        let invoices = 0;
        for (const p of Object.values(payments as Record<string, any>)) {
            if (!p || !paidSet.has(String(p.status))) continue;
            const amount = Number(p.amount) || 0;
            if (isBankSyncExternalId(p.externalId)) receipts += amount;
            else if (invoiceTypes.has(String(p.type))) invoices += amount;
            else receipts += amount;
        }
        const paidGross = receipts > 0 ? receipts : invoices; // приход с НДС
        const gross = grossById.get(Number(o.order_id)) ?? 0;
        const noVat = noVatById.get(Number(o.order_id)) ?? 0;
        const paidNoVat = gross > 0 ? paidGross * (noVat / gross) : paidGross; // → без НДС
        paid += noVat > 0 ? Math.min(paidNoVat, noVat) : paidNoVat;
    }
    const pct = base > 0 ? round2((paid / base) * 100) : null;
    return {
        available: true,
        thresholdPct: policy.threshold_pct,
        paid: round(paid),
        base: round(base),
        pct,
        passed: pct != null ? pct >= policy.threshold_pct : null,
    };
}

/** Пороговые метрики ОКК менеджера за период (зеркалит metrics.ts): скрипт, скорость, ТЗ. */
async function loadOkkMetrics(
    managerId: number,
    year: number,
    month: number,
): Promise<{ script: number | null; fast: number | null; fields: number | null }> {
    const { start, end } = monthBounds(year, month);
    const { data, error } = await supabase
        .from('okk_order_scores')
        .select('script_score_pct,lead_in_work_lt_1_day,tz_received')
        .eq('manager_id', managerId)
        .gte('eval_date', start)
        .lt('eval_date', end);
    if (error) throw error;
    let sumScript = 0, nScript = 0, fast = 0, nFast = 0, fields = 0, nFields = 0;
    for (const s of (data as any[]) ?? []) {
        if (s.script_score_pct != null) { sumScript += Number(s.script_score_pct); nScript += 1; }
        if (s.lead_in_work_lt_1_day != null) { fast += s.lead_in_work_lt_1_day ? 1 : 0; nFast += 1; }
        if (s.tz_received != null) { fields += s.tz_received ? 1 : 0; nFields += 1; }
    }
    return {
        script: nScript > 0 ? sumScript / nScript : null,
        fast: nFast > 0 ? (fast / nFast) * 100 : null,
        fields: nFields > 0 ? (fields / nFields) * 100 : null,
    };
}

/** Грейд менеджера + серия зачётов подряд (по последним закрытым месяцам). */
async function buildGrade(managerId: number, asOf: string): Promise<GradeInfo | null> {
    const [grades, policy] = await Promise.all([resolveManagerGrades(asOf), resolveGradePolicy(asOf)]);
    const level = grades.get(managerId);
    if (level == null) return null;
    const { data } = await supabase
        .from('salary_grade_eval')
        .select('year,month,qualified')
        .eq('manager_id', managerId)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(24);
    let streak = 0;
    for (const r of (data as any[]) ?? []) {
        if (r.qualified) streak++;
        else break;
    }
    const promoteAfter = policy.promoteAfterMonths;
    const atTop = level <= policy.topLevel;
    // promoteAfter − (streak mod promoteAfter): streak 0 → promoteAfter, кратный → снова promoteAfter.
    const monthsToPromote = atTop ? null : promoteAfter - (streak % promoteAfter);
    return { level, floor: policy.floorLevel, top: policy.topLevel, streak, promoteAfter, monthsToPromote };
}
