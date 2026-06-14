import { z } from 'zod';
import { supabase } from '@/utils/supabase';
import { collectPeriodMetrics, type ManagerMetrics } from '@/lib/salary/metrics';
import { getPlansForPeriod, resolveManagerComp } from '@/lib/salary/schemes';

// ============================================================================
// Грейды менеджеров ОП — авто-повышающийся ранг-множитель (СОСТОЯНИЕ, не блок).
// Грейд накапливается по истории: N месяцев выполнения показателей ПОДРЯД → +1
// (к более высокому = меньшему номеру), N месяцев невыполнения ПОДРЯД → −1, но
// не ниже floor. Здесь: политика (из salary_config), помесячная оценка «зачтён/
// нет» (с рангом внутри когорты), пересчёт леджера, резолв грейда «на период».
// Множитель в формуле даёт отдельный блок grade_multiplier (см. extra-blocks).
// ============================================================================

// ── Политика (salary_config['grade_policy'], effective-dated, ноль хардкода) ──

export const GRADE_CRITERION_METRICS = ['plan_attainment', 'conversion', 'okk_total_score', 'avg_check'] as const;
export type GradeCriterionMetric = (typeof GRADE_CRITERION_METRICS)[number];

export const GRADE_CRITERION_LABELS: Record<GradeCriterionMetric, string> = {
    plan_attainment: 'Выполнение личного плана',
    conversion: 'Конверсия',
    okk_total_score: 'Скоринг качества ОКК',
    avg_check: 'Средний чек',
};

const gradeCriterionSchema = z.object({
    metric: z.enum(GRADE_CRITERION_METRICS),
    mode: z.enum(['absolute', 'dept_rank']),
    comparator: z.enum(['gte', 'lte']).optional(), // для mode=absolute
    threshold: z.number().optional(), //            для mode=absolute
    rank: z.number().int().positive().optional(), // для mode=dept_rank (топ-N, по умолч. 1)
    required: z.boolean().default(true),
});

export const GRADE_POLICY_SCHEMA = z.object({
    floorLevel: z.number().int().positive(), // низший грейд (по умолч. 3) — ниже не падаем
    topLevel: z.number().int().positive(), //  высший грейд (по умолч. 1)
    lookbackMonths: z.number().int().positive(), // глубина анализа
    promoteAfterMonths: z.number().int().positive(), // месяцев выполнения подряд → +1
    demoteAfterMonths: z.number().int().positive(), //  месяцев невыполнения подряд → −1
    cohort: z.enum(['scheme', 'register']), // с кем сравнивать dept_rank-критерии
    criteria: z.array(gradeCriterionSchema).min(1),
});

export type GradeCriterion = z.infer<typeof gradeCriterionSchema>;
export type GradePolicy = z.infer<typeof GRADE_POLICY_SCHEMA>;

/** Политика грейдов на дату (последняя версия с effective_from <= asOf). Бросает, если не задана. */
export async function resolveGradePolicy(asOf: string): Promise<GradePolicy> {
    const { data, error } = await supabase
        .from('salary_config')
        .select('value,effective_from')
        .eq('key', 'grade_policy')
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false })
        .limit(1);
    if (error) throw error;
    const raw = (data as any[])?.[0]?.value;
    if (raw == null) throw new Error(`Политика грейдов (grade_policy) не задана на дату ${asOf}. Заполните в настройках.`);
    return GRADE_POLICY_SCHEMA.parse(raw);
}

/** Сохраняет новую версию политики грейдов (effective-dated) + аудит. */
export async function saveGradePolicy(params: { policy: unknown; effectiveFrom: string; actor: string | null }): Promise<void> {
    const { policy, effectiveFrom, actor } = params;
    const validated = GRADE_POLICY_SCHEMA.parse(policy);
    const { error } = await supabase
        .from('salary_config')
        .upsert({ key: 'grade_policy', value: validated, effective_from: effectiveFrom, created_by: actor }, { onConflict: 'key,effective_from' });
    if (error) throw error;
    await supabase.from('salary_audit_log').insert({ entity: 'config', entity_id: 'grade_policy', action: 'update', actor, old_value: null, new_value: validated });
}

// ── Помесячная оценка критериев ──────────────────────────────────────────────

/** Значение метрики критерия для менеджера за месяц. */
function criterionValue(metric: GradeCriterionMetric, m: ManagerMetrics, planTarget: number | null): number {
    switch (metric) {
        case 'plan_attainment': {
            const fact = m.countedOrders.reduce((s, o) => s + o.revenueNoVat, 0);
            return planTarget && planTarget > 0 ? (fact / planTarget) * 100 : 0;
        }
        case 'conversion':
            return m.conversion.pct;
        case 'okk_total_score':
            return m.qualityAvgScore ?? 0;
        case 'avg_check': {
            const n = m.countedOrders.length;
            return n > 0 ? m.countedOrders.reduce((s, o) => s + o.revenueNoVat, 0) / n : 0;
        }
    }
}

export interface CriterionEval {
    metric: GradeCriterionMetric;
    label: string;
    mode: 'absolute' | 'dept_rank';
    value: number;
    passed: boolean;
    required: boolean;
    rank?: number; // для dept_rank — позиция в когорте (1 = лучший)
    cutoff?: number; // для dept_rank — порог попадания в топ-N
    threshold?: number; // для absolute
    comparator?: 'gte' | 'lte';
}

export interface ManagerMonthEval {
    managerId: number;
    schemeCode: string | null;
    qualified: boolean;
    criteria: CriterionEval[];
}

/**
 * Оценка одного месяца по всем менеджерам реестра: для dept_rank-критериев
 * ранжируем внутри когорты (роль или весь реестр), для absolute — по порогу.
 * Месяц «зачтён», если пройдены ВСЕ обязательные (required) критерии.
 */
export function evaluateMonth(
    policy: GradePolicy,
    managers: ManagerMetrics[],
    comp: Map<number, { schemeCode: string }>,
    planByManager: Map<number, number>,
): ManagerMonthEval[] {
    // только менеджеры реестра (с назначенной схемой) участвуют в грейдах
    const regManagers = managers.filter((m) => comp.has(m.managerId));
    const cohortKey = (managerId: number) =>
        policy.cohort === 'scheme' ? comp.get(managerId)?.schemeCode ?? '∅' : 'all';

    // предрасчёт cutoff для каждого dept_rank-критерия по каждой когорте
    const cutoffByCriterionCohort = new Map<string, number>(); // `${idx}:${cohort}` → cutoff
    policy.criteria.forEach((c, idx) => {
        if (c.mode !== 'dept_rank') return;
        const byCohort = new Map<string, number[]>();
        for (const m of regManagers) {
            const k = cohortKey(m.managerId);
            const arr = byCohort.get(k) ?? [];
            arr.push(criterionValue(c.metric, m, planByManager.get(m.managerId) ?? null));
            byCohort.set(k, arr);
        }
        const rank = c.rank ?? 1;
        for (const [k, vals] of Array.from(byCohort)) {
            const sorted = [...vals].sort((a, b) => b - a);
            // порог попадания в топ-N: значение на позиции (rank-1); меньше менеджеров → берём последнее
            const cutoff = sorted[Math.min(rank, sorted.length) - 1] ?? 0;
            cutoffByCriterionCohort.set(`${idx}:${k}`, cutoff);
        }
    });

    const result: ManagerMonthEval[] = [];
    for (const m of regManagers) {
        const planTarget = planByManager.get(m.managerId) ?? null;
        const cohort = cohortKey(m.managerId);
        const criteria: CriterionEval[] = policy.criteria.map((c, idx) => {
            const value = criterionValue(c.metric, m, planTarget);
            const base: CriterionEval = { metric: c.metric, label: GRADE_CRITERION_LABELS[c.metric], mode: c.mode, value, passed: false, required: c.required };
            if (c.mode === 'absolute') {
                const thr = c.threshold ?? 0;
                base.threshold = thr;
                base.comparator = c.comparator ?? 'gte';
                base.passed = base.comparator === 'lte' ? value <= thr : value >= thr;
            } else {
                const cutoff = cutoffByCriterionCohort.get(`${idx}:${cohort}`) ?? 0;
                base.cutoff = cutoff;
                // быть в топ-N когорты: значение не ниже порога И положительное (нулевые метрики не «лучшие»)
                base.passed = value > 0 && value >= cutoff;
            }
            return base;
        });
        const qualified = criteria.filter((c) => c.required).every((c) => c.passed);
        result.push({ managerId: m.managerId, schemeCode: comp.get(m.managerId)?.schemeCode ?? null, qualified, criteria });
    }
    return result;
}

// ── Стрик-логика (чистая, тестируемая) ───────────────────────────────────────

/**
 * Решение по грейду на основе предыдущего уровня и хвоста квалификаций.
 * `qualifiedTail` — флаги «зачтён» по месяцам от ПОСЛЕДНЕГО закрытого назад
 * (index 0 = последний месяц), уже ограниченные окном lookback.
 * Повышение: длина стрика выполнений кратна promoteAfterMonths → +1 (к меньшему номеру).
 * Откат: длина стрика невыполнений кратна demoteAfterMonths → +1 к номеру, не ниже floor.
 */
export function decideGrade(
    policy: GradePolicy,
    prevLevel: number,
    qualifiedTail: boolean[],
): { level: number; change: number; qualStreak: number; failStreak: number } {
    let qualStreak = 0;
    for (const q of qualifiedTail) { if (q) qualStreak++; else break; }
    let failStreak = 0;
    for (const q of qualifiedTail) { if (!q) failStreak++; else break; }

    let level = prevLevel;
    let change = 0;
    if (qualStreak > 0 && qualStreak % policy.promoteAfterMonths === 0) {
        level = Math.max(policy.topLevel, prevLevel - 1);
        change = level - prevLevel; // -1 (или 0, если уже на потолке)
    } else if (failStreak > 0 && failStreak % policy.demoteAfterMonths === 0) {
        level = Math.min(policy.floorLevel, prevLevel + 1);
        change = level - prevLevel; // +1 (или 0, если уже на полу)
    }
    return { level, change, qualStreak, failStreak };
}

// ── Резолв грейда «на период» (для движка ЗП) ────────────────────────────────

/** Карта managerId → текущий уровень грейда на дату (последняя запись effective_from <= asOf). */
export async function resolveManagerGrades(asOf: string): Promise<Map<number, number>> {
    const { data, error } = await supabase
        .from('salary_grade')
        .select('manager_id,grade_level,effective_from')
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false });
    if (error) throw error;
    const map = new Map<number, number>();
    for (const r of (data as any[]) ?? []) {
        const mid = Number(r.manager_id);
        if (!map.has(mid)) map.set(mid, Number(r.grade_level));
    }
    return map;
}

// ── Помощники по месяцам ─────────────────────────────────────────────────────

function monthStart(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}-01`;
}
function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
    const idx = (year * 12 + (month - 1)) + delta;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// ── Пересчёт грейдов (ядро) ──────────────────────────────────────────────────

export interface GradeRecomputeRow {
    managerId: number;
    prevLevel: number;
    newLevel: number;
    change: number;
    qualStreak: number;
    failStreak: number;
}
export interface GradeRecomputeResult {
    throughYear: number;
    throughMonth: number;
    effectiveFrom: string;
    rows: GradeRecomputeRow[];
}

/**
 * Пересчитывает грейды по данным включительно по (throughYear, throughMonth) —
 * последнему закрытому месяцу. Грейд, выведенный из месяцев до M включительно,
 * вступает в силу с 1-го числа M+1 (закрытые периоды не мутируются). Окно
 * анализа = lookbackMonths. Идемпотентно: повторный прогон того же месяца даёт
 * ту же запись (UNIQUE(manager_id, effective_from)). Возвращает решения по реестру.
 */
export async function recomputeGrades(
    throughYear: number,
    throughMonth: number,
    actor: string | null,
): Promise<GradeRecomputeResult> {
    const throughStart = monthStart(throughYear, throughMonth);
    const policy = await resolveGradePolicy(throughStart);
    const eff = addMonths(throughYear, throughMonth, 1);
    const effectiveFrom = monthStart(eff.year, eff.month);

    // 1. Помесячная оценка по окну (от throughMonth назад на lookbackMonths)
    const evalByMonth: { year: number; month: number; evals: ManagerMonthEval[] }[] = [];
    for (let i = 0; i < policy.lookbackMonths; i++) {
        const { year, month } = addMonths(throughYear, throughMonth, -i);
        const asOf = monthStart(year, month);
        const [pm, compMap, plans] = await Promise.all([
            collectPeriodMetrics(year, month),
            resolveManagerComp(asOf),
            getPlansForPeriod(year, month),
        ]);
        const comp = new Map(Array.from(compMap.values()).map((c) => [c.managerId, { schemeCode: c.schemeCode }]));
        const evals = evaluateMonth(policy, pm.managers, comp, plans.personal);
        evalByMonth.push({ year, month, evals });
        // кэш оценок (прозрачность отчёта)
        const rows = evals.map((e) => ({ year, month, manager_id: e.managerId, scheme_code: e.schemeCode, qualified: e.qualified, detail: e.criteria }));
        if (rows.length) {
            const { error } = await supabase.from('salary_grade_eval').upsert(rows, { onConflict: 'year,month,manager_id' });
            if (error) throw error;
        }
    }

    // 2. Реестр на throughMonth — кого грейдуем
    const regComp = await resolveManagerComp(throughStart);
    const managerIds = Array.from(regComp.keys());

    // 3. Предыдущий грейд (действующий В throughMonth, т.е. до effectiveFrom этого прогона)
    const prevGrades = await resolveManagerGrades(throughStart);

    // 4. Решение по каждому менеджеру + запись изменений
    const rows: GradeRecomputeRow[] = [];
    const ledgerWrites: any[] = [];
    for (const managerId of managerIds) {
        // хвост квалификаций: index 0 = последний месяц (throughMonth), дальше назад
        const tail = evalByMonth.map((mo) => mo.evals.find((e) => e.managerId === managerId)?.qualified ?? false);
        const prevLevel = prevGrades.get(managerId) ?? policy.floorLevel;
        const d = decideGrade(policy, prevLevel, tail);
        rows.push({ managerId, prevLevel, newLevel: d.level, change: d.change, qualStreak: d.qualStreak, failStreak: d.failStreak });
        if (d.change !== 0) {
            ledgerWrites.push({
                manager_id: managerId,
                grade_level: d.level,
                effective_from: effectiveFrom,
                source: 'auto',
                reason: { change: d.change, prevLevel, qualStreak: d.qualStreak, failStreak: d.failStreak, throughMonth: throughStart },
                created_by: actor,
            });
        }
    }
    if (ledgerWrites.length) {
        const { error } = await supabase.from('salary_grade').upsert(ledgerWrites, { onConflict: 'manager_id,effective_from' });
        if (error) throw error;
    }

    await supabase.from('salary_audit_log').insert({
        entity: 'grade',
        entity_id: effectiveFrom,
        action: 'recompute',
        actor,
        old_value: null,
        new_value: { throughMonth: throughStart, changed: ledgerWrites.length, managers: rows.length },
    });

    return { throughYear, throughMonth, effectiveFrom, rows };
}

// ── Ручной оверрайд и чтение для UI ──────────────────────────────────────────

/** Ручная установка грейда менеджеру с даты (запись в леджер, source='manual'). */
export async function setManagerGrade(params: { managerId: number; level: number; effectiveFrom: string; actor: string | null; note?: string }): Promise<void> {
    const { managerId, level, effectiveFrom, actor, note } = params;
    const { error } = await supabase
        .from('salary_grade')
        .upsert(
            { manager_id: managerId, grade_level: level, effective_from: effectiveFrom, source: 'manual', reason: { manual: true, note: note ?? null }, created_by: actor },
            { onConflict: 'manager_id,effective_from' },
        );
    if (error) throw error;
    await supabase.from('salary_audit_log').insert({ entity: 'grade', entity_id: String(managerId), action: 'set_manual', actor, old_value: null, new_value: { level, effectiveFrom } });
}

export interface GradeLedgerRow {
    managerId: number;
    level: number;
    effectiveFrom: string;
    source: string;
    reason: any;
}

/** История грейдов (для UI). Без фильтра — все, иначе по менеджеру. */
export async function listGradeLedger(managerId?: number): Promise<GradeLedgerRow[]> {
    let q = supabase.from('salary_grade').select('manager_id,grade_level,effective_from,source,reason').order('effective_from', { ascending: false });
    if (managerId != null) q = q.eq('manager_id', managerId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data as any[]) ?? []).map((r) => ({ managerId: Number(r.manager_id), level: Number(r.grade_level), effectiveFrom: String(r.effective_from), source: r.source, reason: r.reason }));
}
