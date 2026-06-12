import { supabase } from '@/utils/supabase';
import {
    DEAL_SCORE_KEYS,
    SCRIPT_SCORE_KEYS,
    getConsultantCatalog,
    isVisibleBreakdownKey,
} from '@/lib/okk-consultant';
import type { SalaryToolContext } from '@/lib/salary/consultant-tools';

// Read-only OKK rating tools for the consultant. The manager rating is AVG(total_score) over
// okk_order_scores (no dedicated table — mirrors lib/salary/metrics.ts). Criteria are equal-weight;
// marginal value of one fix = 100/(2×checked) for deal, 100/(2×17) for script (see okk-evaluator calcScores).

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;

const DEAL_KEY_SET = new Set<string>(DEAL_SCORE_KEYS as readonly string[]);
const SCRIPT_KEY_SET = new Set<string>(SCRIPT_SCORE_KEYS as readonly string[]);

type ScoreRow = {
    order_id: number;
    total_score: number | null;
    deal_score_pct: number | null;
    script_score_pct: number | null;
    score_breakdown: Record<string, any> | null;
};

function periodRange(year: number, month: number): { start: string; end: string } {
    const mm = String(month).padStart(2, '0');
    const start = `${year}-${mm}-01`;
    const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    return { start, end };
}

function criterionLabel(key: string): string {
    const guide = getConsultantCatalog().criteria.find((c) => c.key === key);
    return guide?.label || key;
}
function criterionFix(key: string): string | null {
    const guide = getConsultantCatalog().criteria.find((c) => c.key === key);
    return guide?.howToFix || null;
}

async function loadScores(managerId: number, year: number, month: number): Promise<ScoreRow[]> {
    const { start, end } = periodRange(year, month);
    const { data } = await supabase
        .from('okk_order_scores')
        .select('order_id, total_score, deal_score_pct, script_score_pct, score_breakdown')
        .eq('manager_id', managerId)
        .gte('eval_date', start)
        .lt('eval_date', end);
    return (data as ScoreRow[]) || [];
}

/** Сколько deal-критериев реально проверено в заказе (result !== null) — знаменатель deal_score_pct. */
function dealCheckedCount(breakdown: Record<string, any> | null): number {
    if (!breakdown) return DEAL_SCORE_KEYS.length;
    let n = 0;
    for (const key of DEAL_SCORE_KEYS) {
        const e = breakdown[key];
        if (e && e.result !== null && e.result !== undefined) n += 1;
    }
    return n || DEAL_SCORE_KEYS.length;
}

function avg(values: number[]): number | null {
    const nums = values.filter((v) => Number.isFinite(v));
    if (!nums.length) return null;
    return r2(nums.reduce((s, v) => s + v, 0) / nums.length);
}

/** Сколько скрипт-критериев реально оценено в заказе (result !== null). 0 = скрипт не оценивался
 *  (обычно нет разговора/транскрипции) — отличаем «нет данных» от «оценён и провален». */
function scriptEvaluatedCount(breakdown: Record<string, any> | null): number {
    if (!breakdown) return 0;
    let n = 0;
    for (const key of SCRIPT_SCORE_KEYS) {
        const e = breakdown[key];
        if (e && e.result !== null && e.result !== undefined) n += 1;
    }
    return n;
}

/** Диагноз: какой блок слабее (даёт наибольший рычаг) + покрытие данными по скрипту.
 *  Чтобы Семён начинал совет с главного и был честен про «нет данных» vs «реально провалено». */
function buildDiagnosis(rows: ScoreRow[]) {
    const dealPct = avg(rows.map((r) => num(r.deal_score_pct)));
    const scriptPct = avg(rows.map((r) => num(r.script_score_pct)));

    let scriptNotEvaluated = 0;
    for (const row of rows) {
        if (scriptEvaluatedCount(row.score_breakdown) === 0) scriptNotEvaluated += 1;
    }
    const scriptEvaluated = rows.length - scriptNotEvaluated;

    let weakestBlock: 'Скрипт' | 'Сделка' | null = null;
    if (dealPct != null && scriptPct != null) weakestBlock = scriptPct <= dealPct ? 'Скрипт' : 'Сделка';

    const coverageNote = scriptNotEvaluated > 0
        ? `У ${scriptNotEvaluated} из ${rows.length} заказов скрипт не оценивался (нет разговора/транскрипции) — часть просадки скрипт-балла из-за отсутствия данных, а не качества. Совет «работай над скриптом» уместен только там, где разговор есть.`
        : `По всем ${rows.length} заказам скрипт оценивался — низкий скрипт-балл отражает реальную работу по скрипту, а не отсутствие данных.`;

    return {
        weakestBlock,
        dealScorePct: dealPct,
        scriptScorePct: scriptPct,
        coverage: { ordersTotal: rows.length, scriptEvaluated, scriptNotEvaluated, note: coverageNote },
        note: weakestBlock
            ? `Слабее всего блок «${weakestBlock}» (Сделка ${dealPct ?? 0}% против Скрипт ${scriptPct ?? 0}%) — начни с него, он даёт наибольший прирост рейтинга.`
            : null,
    };
}

async function getMyRating(managerId: number, year: number, month: number) {
    const rows = await loadScores(managerId, year, month);
    if (!rows.length) {
        return { available: false, reason: `Нет оценённых заказов за ${month}.${year}.`, period: { year, month } };
    }

    const tally = new Map<string, { label: string; pass: number; fail: number; notChecked: number; isScript: boolean }>();
    for (const row of rows) {
        const b = row.score_breakdown || {};
        for (const [key, entry] of Object.entries(b)) {
            if (!isVisibleBreakdownKey(key)) continue;
            const isScript = SCRIPT_KEY_SET.has(key);
            if (!DEAL_KEY_SET.has(key) && !isScript) continue;
            const t = tally.get(key) || { label: criterionLabel(key), pass: 0, fail: 0, notChecked: 0, isScript };
            const res = (entry as any)?.result;
            if (res === true) t.pass += 1;
            else if (res === false) t.fail += 1;
            else t.notChecked += 1;
            tally.set(key, t);
        }
    }

    const topFailed = Array.from(tally.entries())
        .map(([key, t]) => ({ key, label: t.label, fail: t.fail, pass: t.pass, group: t.isScript ? 'Скрипт' : 'Сделка' }))
        .filter((c) => c.fail > 0)
        .sort((a, b) => b.fail - a.fail)
        .slice(0, 8);

    return {
        available: true,
        period: { year, month },
        orders: rows.length,
        avgTotalScore: avg(rows.map((r) => num(r.total_score))),
        avgDealScorePct: avg(rows.map((r) => num(r.deal_score_pct))),
        avgScriptScorePct: avg(rows.map((r) => num(r.script_score_pct))),
        diagnosis: buildDiagnosis(rows),
        topFailedCriteria: topFailed,
        note: 'Рейтинг менеджера = средний total_score по заказам периода. Критерии равновесные.',
    };
}

async function howToImprove(managerId: number, year: number, month: number) {
    const rows = await loadScores(managerId, year, month);
    if (!rows.length) {
        return { available: false, reason: `Нет оценённых заказов за ${month}.${year}.`, period: { year, month } };
    }

    // Агрегируем проваленные критерии: частота + предельные баллы (по движку оценки).
    const agg = new Map<string, { label: string; isScript: boolean; failCount: number; marginalSum: number }>();
    for (const row of rows) {
        const b = row.score_breakdown || {};
        const dealChecked = dealCheckedCount(b);
        for (const [key, entry] of Object.entries(b)) {
            if (!isVisibleBreakdownKey(key)) continue;
            if ((entry as any)?.result !== false) continue;
            const isScript = SCRIPT_KEY_SET.has(key);
            if (!DEAL_KEY_SET.has(key) && !isScript) continue;
            // Прибавка к total за фикс на ОДНОМ заказе: половина изменения соответствующего pct.
            const marginal = isScript ? 100 / (2 * SCRIPT_SCORE_KEYS.length) : 100 / (2 * dealChecked);
            const a = agg.get(key) || { label: criterionLabel(key), isScript, failCount: 0, marginalSum: 0 };
            a.failCount += 1;
            a.marginalSum += marginal;
            agg.set(key, a);
        }
    }

    const ranked = Array.from(agg.entries())
        .map(([key, a]) => ({
            key,
            label: a.label,
            group: a.isScript ? 'Скрипт' : 'Сделка',
            failCount: a.failCount,
            // Прирост СРЕДНЕГО рейтинга, если исправить этот критерий на всех заказах, где он провален.
            estAvgRatingGain: r2(a.marginalSum / rows.length),
            howToFix: criterionFix(key),
        }))
        .sort((x, y) => y.estAvgRatingGain - x.estAvgRatingGain)
        .slice(0, 6);

    // Рычаг штрафов: суммарные штрафные баллы по заказам периода.
    const orderIds = rows.map((r) => r.order_id);
    let penaltyPoints = 0;
    if (orderIds.length) {
        const { data: vios } = await supabase
            .from('okk_violations')
            .select('points')
            .in('order_id', orderIds);
        penaltyPoints = ((vios as Array<{ points?: number | null }>) || []).reduce((s, v) => s + num(v.points), 0);
    }

    return {
        available: true,
        period: { year, month },
        orders: rows.length,
        diagnosis: buildDiagnosis(rows),
        topFixes: ranked,
        penaltyLever: { totalPenaltyPoints: penaltyPoints, note: 'Штрафы напрямую вычитаются из total_score. Их устранение поднимает рейтинг отдельно от критериев.' },
        note: 'estAvgRatingGain — оценка прироста СРЕДНЕГО рейтинга, если критерий исправить на всех заказах, где он провален (критерии равновесные). Начинай совет с diagnosis.weakestBlock и учитывай diagnosis.coverage (нет данных vs реально провалено).',
    };
}

export const RATING_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'get_my_rating',
            description: 'Рейтинг ОКК текущего пользователя за период: средний total_score, средние deal/script проценты, число заказов, самые часто проваленные критерии и diagnosis (слабый блок + покрытие данными скрипта). Только свой рейтинг.',
            parameters: {
                type: 'object',
                properties: {
                    year: { type: 'integer', description: 'Год. По умолчанию текущий.' },
                    month: { type: 'integer', description: 'Месяц 1-12. По умолчанию текущий.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'how_to_improve_my_rating',
            description: 'Как поднять рейтинг ОКК: diagnosis (какой блок слабее + честное покрытие данными скрипта), ранжированный список критериев с наибольшим приростом среднего рейтинга при исправлении и рекомендациями, плюс рычаг штрафов. Используй для вопросов «как поднять рейтинг», «что исправить в первую очередь», «на что обратить внимание».',
            parameters: {
                type: 'object',
                properties: {
                    year: { type: 'integer' },
                    month: { type: 'integer' },
                },
            },
        },
    },
];

export async function executeRatingTool(name: string, args: any, ctx: SalaryToolContext): Promise<any> {
    if (ctx.retailCrmManagerId == null) {
        return { available: false, reason: 'У пользователя не привязан менеджер RetailCRM — персональный рейтинг недоступен.' };
    }
    const year = Number(args?.year) || ctx.defaultYear;
    const month = Number(args?.month) || ctx.defaultMonth;

    if (name === 'get_my_rating') return getMyRating(ctx.retailCrmManagerId, year, month);
    if (name === 'how_to_improve_my_rating') return howToImprove(ctx.retailCrmManagerId, year, month);
    return { available: false, reason: `Неизвестный инструмент: ${name}` };
}
