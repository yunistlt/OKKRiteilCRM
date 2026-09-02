import { businessDaysInMonth } from '@/lib/salary/engine';
import { getPlansForPeriod, listSchemes, resolveManagerComp } from '@/lib/salary/schemes';
import { resolveGradePolicy, resolveManagerGrades } from '@/lib/salary/grades';
import { computePrepayForOrders } from '@/lib/salary/my-dashboard';
import { pickTier } from '@/lib/salary/blocks/tiers';
import { supabase } from '@/utils/supabase';
import type { BlockContribution } from '@/lib/salary/blocks/types';

// ============================================================================
// «Приборная панель» руководителя на /salary — консолидированный взгляд на весь
// отдел: план, структура ФОТ по блокам, ОТДЕЛЬНАЯ строка на каждый коэффициент
// с его рублёвым эффектом, сравнение менеджеров и авто-флаги «требует внимания».
//
// Ноль хардкода: пороги/ступени берутся из назначенных схем (salary_scheme_block),
// планы — из salary_plan, грейды — из salary_grade. Считается ПОВЕРХ уже
// посчитанных строк периода (loadPeriodView), движок повторно не гоняем.
// ============================================================================

const round = (n: number) => Math.round(Number(n) || 0);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface AdminManagerRow {
    managerId: number;
    name: string;
    schemeCode: string | null;
    schemeName: string | null;
    revenueNoVat: number;
    orders: number;
    planTarget: number | null;
    planPct: number | null;
    conversionNum: number;
    conversionDen: number;
    conversionPct: number | null;
    qualityScore: number | null;
    discountValue: number | null;
    prepayPct: number | null;
    prepayPassed: boolean | null;
    grade: number | null;
    grossBeforeMultipliers: number; // начислено до коэффициентов (премии + переменные + оклад + разовые)
    total: number;
    fotSharePct: number;
    salaryToRevenuePct: number | null;
}

/** Аддитивный блок: сумма по отделу + вклад каждого менеджера (null — блока нет в его схеме). */
export interface AdminBlockRow {
    code: string;
    name: string;
    group: string;
    total: number;
    byManager: Record<number, number | null>;
}

/** Коэффициент: рублёвый эффект по отделу + множитель и эффект каждого менеджера. */
export interface AdminMultiplierRow {
    code: string;
    name: string;
    scope: string;
    totalEffect: number;
    byManager: Record<number, { k: number | null; effect: number }>;
    note: string | null; // человеческое пояснение, почему коэффициент такой
}

export interface AdminAlert {
    code: string;
    level: 'bad' | 'warn' | 'info';
    title: string;
    detail: string;
}

export interface AdminHistoryPoint {
    year: number;
    month: number;
    status: string;
    fot: number;
    revenue: number;
    ratioPct: number | null;
}

export interface AdminDashboard {
    managers: AdminManagerRow[];
    blocks: AdminBlockRow[];
    multipliers: AdminMultiplierRow[];
    totals: {
        fot: number;
        engineersFot: number;
        fotAll: number;
        grossBeforeMultipliers: number;
        revenueNoVat: number;
        planDept: number | null;
        planDeptPct: number | null;
        planDeptRemaining: number | null;
        orders: number;
        conversionPct: number | null;
        conversionNum: number;
        conversionDen: number;
        qualityScore: number | null;
        prepayPct: number | null;
        prepayThresholdPct: number | null;
        salaryToRevenuePct: number | null;
    };
    pace: {
        isCurrentMonth: boolean;
        calendarDaysLeft: number;
        businessDaysLeft: number;
        expectedPct: number;
        requiredPerDay: number | null;
    };
    grade: { floor: number; top: number } | null;
    alerts: AdminAlert[];
    history: AdminHistoryPoint[];
}

type Tier = { min: number; k: number };

/** Ближайшая вверх ступень, реально повышающая коэффициент (пропускаем ступени с тем же k). */
function nextRewardTier(value: number, curK: number, tiers: Tier[]): Tier | null {
    const better = tiers.filter((t) => t.min > value && t.k > curK).sort((a, b) => a.min - b.min);
    return better[0] ?? null;
}

const fmtRub = (n: number) => `${round(n).toLocaleString('ru-RU')} ₽`;
const fmtPct = (n: number) => `${round2(n).toLocaleString('ru-RU')}%`;

/**
 * Собирает панель руководителя поверх строк расчёта периода.
 * `rows` — строки в форме salary_calc (live или снимок) с именем менеджера.
 */
export async function buildAdminDashboard(params: {
    year: number;
    month: number;
    rows: any[];
    teamRevenueNoVat: number;
    engineersFot: number;
}): Promise<AdminDashboard> {
    const { year, month, rows, teamRevenueNoVat, engineersFot } = params;
    const asOf = `${year}-${String(month).padStart(2, '0')}-01`;

    const [plans, comps, schemes, grades, gradePolicy] = await Promise.all([
        getPlansForPeriod(year, month),
        resolveManagerComp(asOf),
        listSchemes(asOf).catch(() => []),
        resolveManagerGrades(asOf).catch(() => new Map<number, number>()),
        resolveGradePolicy(asOf).catch(() => null),
    ]);
    const schemeNameByCode = new Map(schemes.map((s) => [s.code, s.name]));

    // ── Строки менеджеров ────────────────────────────────────────────────────
    const managers: AdminManagerRow[] = [];
    const blockOrder: { code: string; name: string; group: string }[] = [];
    const blockSeen = new Set<string>();
    const multOrder: { code: string; name: string; scope: string }[] = [];
    const multSeen = new Set<string>();
    const blockByManager = new Map<string, Record<number, number | null>>();
    const multByManager = new Map<string, Record<number, { k: number | null; effect: number }>>();
    const bracketBaseById = new Map<number, number>(); // премии+переменные до множителей
    const okladNotes: { managerId: number; name: string; explain: string; diff: number }[] = [];

    const fotTotal = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);

    for (const r of rows) {
        const managerId = Number(r.manager_id);
        const b = r.breakdown ?? {};
        const contribs: BlockContribution[] = Array.isArray(b.blockContributions) ? b.blockContributions : [];
        const countedOrders: any[] = Array.isArray(b.countedOrders) ? b.countedOrders : [];
        const countedIds: number[] = Array.isArray(b.countedOrderIds)
            ? b.countedOrderIds
            : countedOrders.map((o) => Number(o.id)).filter(Boolean);
        const revenue = countedOrders.reduce((s, o) => s + (Number(o.revenueNoVat) || 0), 0);

        // Аддитивные вклады (всё, кроме множителей) — каждый своей строкой.
        const additive = contribs.filter((c) => c.kind !== 'multiplier');
        for (const c of additive) {
            if (!blockSeen.has(c.code)) {
                blockSeen.add(c.code);
                blockOrder.push({ code: c.code, name: c.name, group: c.group });
            }
            const map = blockByManager.get(c.code) ?? {};
            map[managerId] = (map[managerId] ?? 0) + (Number(c.amount) || 0);
            blockByManager.set(c.code, map);
        }

        // Эффект каждого коэффициента в рублях: применяем по порядку схемы —
        // сперва множители премии, затем множители всей переменной скобки.
        const premiaBase = additive.filter((c) => c.group === 'premia').reduce((s, c) => s + (Number(c.amount) || 0), 0);
        const variableBase = additive.filter((c) => c.group === 'variable').reduce((s, c) => s + (Number(c.amount) || 0), 0);
        const rawAdditive = additive.reduce((s, c) => s + (Number(c.amount) || 0), 0);
        bracketBaseById.set(managerId, premiaBase + variableBase);

        const mults = contribs.filter((c) => c.kind === 'multiplier');
        let running = premiaBase;
        const effects = new Map<string, { k: number | null; effect: number }>();
        for (const c of mults.filter((c) => c.multiplierScope === 'premia')) {
            const k = c.multiplier ?? 1;
            effects.set(c.code, { k, effect: round(running * (k - 1)) });
            running *= k;
        }
        running += variableBase;
        for (const c of mults.filter((c) => c.multiplierScope !== 'premia')) {
            const k = c.multiplier ?? 1;
            effects.set(c.code, { k, effect: round(running * (k - 1)) });
            running *= k;
        }
        for (const c of mults) {
            if (!multSeen.has(c.code)) {
                multSeen.add(c.code);
                multOrder.push({ code: c.code, name: c.name, scope: c.multiplierScope ?? 'variableBracket' });
            }
            const map = multByManager.get(c.code) ?? {};
            map[managerId] = effects.get(c.code) ?? { k: c.multiplier ?? 1, effect: 0 };
            multByManager.set(c.code, map);
        }

        // Урезанный оклад (отпуск/табель) — руководителю это надо видеть сразу, иначе
        // выглядит как ошибка расчёта. Пояснение берём из explain блока.
        const okladContrib = contribs.find((c) => c.code === 'oklad');
        const okladParam = Number(comps.get(managerId)?.blocks.find((b) => b.code === 'oklad')?.params?.oklad) || 0;
        if (okladContrib && okladParam > 0 && Number(okladContrib.amount) < okladParam - 1) {
            okladNotes.push({
                managerId,
                name: r.manager_name || `#${managerId}`,
                explain: okladContrib.explain,
                diff: round(okladParam - Number(okladContrib.amount)),
            });
        }

        const prepay = await computePrepayForOrders(countedIds, countedOrders, asOf).catch(() => null);
        const planTarget = plans.personal.get(managerId) ?? null;
        const total = Number(r.total) || 0;
        const convDen = Number(b.conversionDenominator) || 0;
        const convNum = Number(b.conversionNumerator) || 0;
        const comp = comps.get(managerId) ?? null;

        managers.push({
            managerId,
            name: r.manager_name || `#${managerId}`,
            schemeCode: comp?.schemeCode ?? (b.schemeCode || null),
            schemeName: schemeNameByCode.get(comp?.schemeCode ?? b.schemeCode) ?? null,
            revenueNoVat: round(revenue),
            orders: countedIds.length,
            planTarget,
            planPct: planTarget && planTarget > 0 ? round2((revenue / planTarget) * 100) : null,
            conversionNum: convNum,
            conversionDen: convDen,
            conversionPct: convDen > 0 ? round2(b.conversionPct != null ? Number(b.conversionPct) : (convNum / convDen) * 100) : null,
            qualityScore: b.qualityScore != null ? round(Number(b.qualityScore)) : null,
            discountValue: b.discountValue != null ? round2(Number(b.discountValue)) : null,
            prepayPct: prepay?.pct ?? null,
            prepayPassed: prepay?.passed ?? null,
            grade: grades.get(managerId) ?? null,
            grossBeforeMultipliers: round(rawAdditive),
            total: round(total),
            fotSharePct: fotTotal > 0 ? round2((total / fotTotal) * 100) : 0,
            salaryToRevenuePct: revenue > 0 ? round2((total / revenue) * 100) : null,
        });
    }

    managers.sort((a, b) => b.total - a.total);
    const ids = managers.map((m) => m.managerId);

    const blocks: AdminBlockRow[] = blockOrder.map((b) => {
        const byManager: Record<number, number | null> = {};
        for (const id of ids) byManager[id] = blockByManager.get(b.code)?.[id] ?? null;
        return {
            ...b,
            total: round(Object.values(byManager).reduce((s: number, v) => s + (v ?? 0), 0)),
            byManager,
        };
    });

    const multipliers: AdminMultiplierRow[] = multOrder.map((m) => {
        const byManager: Record<number, { k: number | null; effect: number }> = {};
        for (const id of ids) byManager[id] = multByManager.get(m.code)?.[id] ?? { k: null, effect: 0 };
        return {
            ...m,
            totalEffect: round(Object.values(byManager).reduce((s, v) => s + (v?.effect ?? 0), 0)),
            byManager,
            note: null,
        };
    });

    // ── Итоги отдела ─────────────────────────────────────────────────────────
    const revenue = Number(teamRevenueNoVat) || managers.reduce((s, m) => s + m.revenueNoVat, 0);
    const planDept = plans.department;
    const convNum = managers.reduce((s, m) => s + m.conversionNum, 0);
    const convDen = managers.reduce((s, m) => s + m.conversionDen, 0);
    const qualityVals = managers.map((m) => m.qualityScore).filter((v): v is number => v != null);
    const prepayVals = managers.map((m) => m.prepayPct).filter((v): v is number => v != null);
    const grossBefore = managers.reduce((s, m) => s + m.grossBeforeMultipliers, 0);

    // Порог предоплаты — из политики (через любой посчитанный prepay: он же его и вернул).
    let prepayThresholdPct: number | null = null;
    try {
        const anyRow = rows[0];
        const co: any[] = Array.isArray(anyRow?.breakdown?.countedOrders) ? anyRow.breakdown.countedOrders : [];
        const p = await computePrepayForOrders([], co, asOf);
        prepayThresholdPct = p.thresholdPct;
    } catch { /* политики нет — порог не показываем */ }

    // ── Темп ─────────────────────────────────────────────────────────────────
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
    const daysInMonth = new Date(year, month, 0).getDate();
    const businessDaysTotal = businessDaysInMonth(year, month);
    const today = isCurrentMonth ? now.getDate() : daysInMonth;
    let businessDaysElapsed = 0;
    for (let d = 1; d <= today; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        if (dow !== 0 && dow !== 6) businessDaysElapsed++;
    }
    const businessDaysLeft = Math.max(0, businessDaysTotal - businessDaysElapsed);
    const planRemaining = planDept != null ? Math.max(0, round(planDept - revenue)) : null;

    // ── Флаги «требует внимания» ─────────────────────────────────────────────
    const paramsByManager = new Map<number, Map<string, any>>();
    for (const m of managers) {
        const map = new Map<string, any>();
        for (const bl of comps.get(m.managerId)?.blocks ?? []) map.set(bl.code, bl.params ?? {});
        paramsByManager.set(m.managerId, map);
    }
    const alerts = buildAlerts({
        managers,
        multipliers,
        paramsByManager,
        bracketBaseById,
        revenue,
        planDept,
        gradePolicy,
        prepayThresholdPct,
    });
    for (const n of okladNotes) {
        alerts.unshift({
            code: `oklad:${n.managerId}`,
            level: 'info',
            title: `${n.name}: оклад за неполный месяц — −${fmtRub(n.diff)}`,
            detail: `${n.explain}. Дни отсутствия берутся из отпусков в модуле распределения заявок; ручной табель, если он заполнен, имеет приоритет.`,
        });
    }

    return {
        managers,
        blocks,
        multipliers,
        totals: {
            fot: round(fotTotal),
            engineersFot: round(engineersFot),
            fotAll: round(fotTotal + engineersFot),
            grossBeforeMultipliers: round(grossBefore),
            revenueNoVat: round(revenue),
            planDept,
            planDeptPct: planDept && planDept > 0 ? round2((revenue / planDept) * 100) : null,
            planDeptRemaining: planRemaining,
            orders: managers.reduce((s, m) => s + m.orders, 0),
            conversionPct: convDen > 0 ? round2((convNum / convDen) * 100) : null,
            conversionNum: convNum,
            conversionDen: convDen,
            qualityScore: qualityVals.length ? round(qualityVals.reduce((s, v) => s + v, 0) / qualityVals.length) : null,
            prepayPct: prepayVals.length ? round(prepayVals.reduce((s, v) => s + v, 0) / prepayVals.length) : null,
            prepayThresholdPct,
            salaryToRevenuePct: revenue > 0 ? round2((fotTotal / revenue) * 100) : null,
        },
        pace: {
            isCurrentMonth,
            calendarDaysLeft: isCurrentMonth ? Math.max(0, daysInMonth - today) : 0,
            businessDaysLeft,
            expectedPct: businessDaysTotal > 0 ? round2((businessDaysElapsed / businessDaysTotal) * 100) : 0,
            requiredPerDay: planRemaining != null ? (businessDaysLeft > 0 ? round(planRemaining / businessDaysLeft) : 0) : null,
        },
        grade: gradePolicy ? { floor: gradePolicy.floorLevel, top: gradePolicy.topLevel } : null,
        alerts,
        history: await buildHistory(year, month, { fot: round(fotTotal), revenue: round(revenue) }).catch(() => []),
    };
}

/** Флаги строятся из ступеней/порогов схем — ни одного числа в коде. */
function buildAlerts(p: {
    managers: AdminManagerRow[];
    multipliers: AdminMultiplierRow[];
    paramsByManager: Map<number, Map<string, any>>;
    bracketBaseById: Map<number, number>;
    revenue: number;
    planDept: number | null;
    gradePolicy: any;
    prepayThresholdPct: number | null;
}): AdminAlert[] {
    const { managers, multipliers, paramsByManager, bracketBaseById, revenue, planDept, gradePolicy, prepayThresholdPct } = p;
    const alerts: AdminAlert[] = [];

    // Произведение остальных множителей переменной скобки (для точной прибавки в ₽).
    const otherMultProduct = (managerId: number, exceptCode: string) =>
        multipliers
            .filter((m) => m.scope !== 'premia' && m.code !== exceptCode)
            .reduce((prod, m) => prod * (m.byManager[managerId]?.k ?? 1), 1);

    // 1. Личный план: до какой ступени коэффициента и что это даёт в рублях.
    for (const m of managers) {
        const tiers = paramsByManager.get(m.managerId)?.get('plan_coef')?.tiers as Tier[] | undefined;
        if (!tiers || !m.planTarget || m.planPct == null) continue;
        const cur = multipliers.find((x) => x.code === 'plan_coef')?.byManager[m.managerId]?.k ?? pickTier(m.planPct, tiers)?.k ?? 1;
        const next = nextRewardTier(m.planPct, cur, tiers);
        if (!next) continue;
        const need = Math.max(0, round(m.planTarget * (next.min / 100) - m.revenueNoVat));
        const gain = round((bracketBaseById.get(m.managerId) ?? 0) * otherMultProduct(m.managerId, 'plan_coef') * (next.k - cur));
        if (gain <= 0) continue;
        alerts.push({
            code: `plan_coef:${m.managerId}`,
            level: m.planPct < (Math.min(...tiers.filter((t) => t.k > 0).map((t) => t.min))) ? 'bad' : 'warn',
            title: `${m.name}: ${fmtPct(m.planPct)} личного плана — ×${round2(cur)}`,
            detail: `До ступени ${fmtPct(next.min)} (×${round2(next.k)}) не хватает ${fmtRub(need)} выручки. Это ${gain > 0 ? '+' : ''}${fmtRub(gain)} к её ЗП.`,
        });
    }

    // 2. Коэффициенты уровня отдела (план отдела, К_команды) — общий эффект на ФОТ.
    for (const code of ['dept_plan_coef', 'k_team']) {
        const row = multipliers.find((m) => m.code === code);
        if (!row) continue;
        // Параметры одинаковы у всех в схеме — берём у первого, у кого блок есть.
        const owner = managers.find((m) => paramsByManager.get(m.managerId)?.has(code));
        const tiers = owner ? (paramsByManager.get(owner.managerId)!.get(code)?.tiers as Tier[] | undefined) : undefined;
        if (!tiers) continue;
        const metric = code === 'dept_plan_coef' && planDept && planDept > 0 ? (revenue / planDept) * 100 : revenue;
        const cur = row.byManager[managers[0]?.managerId ?? 0]?.k ?? pickTier(metric, tiers)?.k ?? 1;
        const next = nextRewardTier(metric, cur, tiers);
        if (!next) continue;
        const need =
            code === 'dept_plan_coef' && planDept
                ? Math.max(0, round(planDept * (next.min / 100) - revenue))
                : Math.max(0, round(next.min - revenue));
        const gain = managers.reduce(
            (s, m) => s + (bracketBaseById.get(m.managerId) ?? 0) * otherMultProduct(m.managerId, code) * (next.k - cur),
            0,
        );
        if (gain <= 0) continue;
        const below = pickTier(metric, tiers) == null;
        alerts.push({
            code,
            level: 'info',
            title: `${row.name} ×${round2(cur)}${below ? ' — ниже нижней ступени' : ''}`,
            detail:
                `Отделу до ступени ×${round2(next.k)} не хватает ${fmtRub(need)} выручки — это ${fmtRub(gain)} к ФОТ.` +
                (below ? ' Ниже нижней ступени коэффициент равен ×1 — вниз он не режет.' : ''),
        });
    }

    // 3. Конв-бонус: у кого блок есть, но он нулевой — показываем порог и факт.
    const convOwners = managers.filter((m) => paramsByManager.get(m.managerId)?.has('conv_bonus'));
    if (convOwners.length) {
        const zero = convOwners.filter((m) => {
            const params = paramsByManager.get(m.managerId)!.get('conv_bonus');
            const tiers = (params?.tiers ?? []) as { min: number; bonus: number }[];
            const t = pickTier(m.conversionPct ?? 0, tiers.map((x) => ({ min: x.min, k: x.bonus })) as any);
            return !t || !(t as any).k;
        });
        if (zero.length === convOwners.length) {
            const params = paramsByManager.get(convOwners[0].managerId)!.get('conv_bonus');
            const tiers = ((params?.tiers ?? []) as { min: number; bonus: number }[]).filter((t) => t.bonus > 0);
            const minTier = tiers.length ? Math.min(...tiers.map((t) => t.min)) : null;
            const facts = convOwners.map((m) => m.conversionPct ?? 0);
            alerts.push({
                code: 'conv_bonus',
                level: 'bad',
                title: 'Конв-бонус не получил никто',
                detail: minTier != null
                    ? `Нижняя ступень бонуса — конверсия ${fmtPct(minTier)}, факт ${fmtPct(Math.min(...facts))}–${fmtPct(Math.max(...facts))}. Проверьте порог в схеме или состав входящих заявок.`
                    : 'Ни у кого не начислен — проверьте параметры блока в схеме.',
            });
        }
    }

    // 4. Предоплата ниже порога.
    if (prepayThresholdPct != null) {
        for (const m of managers) {
            if (m.prepayPct == null || m.prepayPassed !== false) continue;
            alerts.push({
                code: `prepay:${m.managerId}`,
                level: 'bad',
                title: `${m.name}: предоплата ${fmtPct(m.prepayPct)}`,
                detail: `Ниже порога ${fmtPct(prepayThresholdPct)} по засчитанным заказам — премия под риском.`,
            });
        }
    }

    // 5. Грейды: если все на полу — механика не работает.
    if (gradePolicy && managers.length) {
        const withGrade = managers.filter((m) => m.grade != null);
        if (withGrade.length && withGrade.every((m) => m.grade === gradePolicy.floorLevel)) {
            alerts.push({
                code: 'grades',
                level: 'info',
                title: `Грейды: все на уровне ${gradePolicy.floorLevel} из ${gradePolicy.floorLevel}`,
                detail: 'Грейд-коэффициент у всех ×1 — на ЗП сейчас не влияет. Проверьте пересчёт грейдов и политику.',
            });
        }
    }

    return alerts;
}

/** История ФОТ/выручки по периодам с расчётом (снимки salary_calc) + текущий период. */
async function buildHistory(
    year: number,
    month: number,
    current: { fot: number; revenue: number },
): Promise<AdminHistoryPoint[]> {
    const { data: periods } = await supabase
        .from('salary_period')
        .select('id,year,month,status')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(6);
    const list = ((periods as any[]) ?? []).slice().reverse();
    if (!list.length) return [];
    const { data: calc } = await supabase
        .from('salary_calc')
        .select('period_id,total,breakdown')
        .in('period_id', list.map((p) => p.id));
    const byPeriod = new Map<number, { fot: number; revenue: number }>();
    for (const r of (calc as any[]) ?? []) {
        const agg = byPeriod.get(Number(r.period_id)) ?? { fot: 0, revenue: 0 };
        agg.fot += Number(r.total) || 0;
        const co: any[] = Array.isArray(r.breakdown?.countedOrders) ? r.breakdown.countedOrders : [];
        agg.revenue += co.reduce((s, o) => s + (Number(o.revenueNoVat) || 0), 0);
        byPeriod.set(Number(r.period_id), agg);
    }
    return list.map((p) => {
        const isCurrent = p.year === year && p.month === month;
        const agg = isCurrent ? current : byPeriod.get(Number(p.id)) ?? { fot: 0, revenue: 0 };
        return {
            year: p.year,
            month: p.month,
            status: p.status,
            fot: round(agg.fot),
            revenue: round(agg.revenue),
            ratioPct: agg.revenue > 0 ? round2((agg.fot / agg.revenue) * 100) : null,
        };
    });
}
