/**
 * Тесты грейдов: чистая стрик-логика (повышение/откат/пол/потолок), помесячная
 * оценка критериев (dept_rank внутри когорты + absolute-порог) и режим «приз
 * месяца» (гейт + приоритет показателей + пол). Без БД.
 */
import { describe, it, expect } from 'vitest';
import { assignMonthlyPrize, decideGrade, evaluateMonth, evaluatePrizeMonth, type GradePolicy } from '@/lib/salary/grades';
import type { ManagerMetrics } from '@/lib/salary/metrics';

const POLICY: GradePolicy = {
    floorLevel: 3,
    topLevel: 1,
    lookbackMonths: 6,
    promoteAfterMonths: 3,
    demoteAfterMonths: 2,
    cohort: 'scheme',
    criteria: [
        { metric: 'conversion', mode: 'dept_rank', rank: 1, required: true },
        { metric: 'plan_attainment', mode: 'absolute', comparator: 'gte', threshold: 100, required: true },
    ],
};

// Минимальные метрики менеджера (только поля, которые читает evaluateMonth).
function make(managerId: number, opts: { revenue?: number; orders?: number; conversionPct?: number; quality?: number | null }): ManagerMetrics {
    const n = opts.orders ?? 1;
    const rev = opts.revenue ?? 0;
    const countedOrders = Array.from({ length: n }, () => ({ revenueNoVat: rev / n })) as any[];
    return {
        managerId,
        countedOrders,
        countsByType: { new: 0, permanent: 0 },
        countsByCategory: {},
        revenueByCategory: {},
        discountMetricValue: null,
        qualityAvgScore: opts.quality ?? null,
        qualityScriptPct: null,
        fastContactShare: null,
        fieldsFilledShare: null,
        conversion: { numerator: 0, denominator: 0, pct: opts.conversionPct ?? 0, eligible: true },
        dutyShifts: 0,
        workedDays: null,
        marginTotal: 0,
    };
}

describe('decideGrade — стрик-логика', () => {
    it('повышает на 1 ровно при стрике выполнений = promoteAfterMonths', () => {
        const d = decideGrade(POLICY, 3, [true, true, true]);
        expect(d.qualStreak).toBe(3);
        expect(d.level).toBe(2);
        expect(d.change).toBe(-1);
    });
    it('не повышает, если стрик короче порога', () => {
        const d = decideGrade(POLICY, 3, [true, true, false, true]);
        expect(d.qualStreak).toBe(2);
        expect(d.level).toBe(3);
        expect(d.change).toBe(0);
    });
    it('не поднимается выше потолка (topLevel)', () => {
        const d = decideGrade(POLICY, 1, [true, true, true]);
        expect(d.level).toBe(1);
        expect(d.change).toBe(0);
    });
    it('откатывает на 1 при стрике невыполнений = demoteAfterMonths', () => {
        const d = decideGrade(POLICY, 2, [false, false]);
        expect(d.failStreak).toBe(2);
        expect(d.level).toBe(3);
        expect(d.change).toBe(1);
    });
    it('не падает ниже пола (floorLevel)', () => {
        const d = decideGrade(POLICY, 3, [false, false, false, false]);
        expect(d.level).toBe(3);
        expect(d.change).toBe(0);
    });
    it('один провал не откатывает (стрик короче demoteAfterMonths)', () => {
        const d = decideGrade(POLICY, 2, [false, true, true]);
        expect(d.failStreak).toBe(1);
        expect(d.change).toBe(0);
    });
});

describe('evaluateMonth — оценка месяца', () => {
    const comp = new Map([
        [10, { schemeCode: 'seller' }],
        [20, { schemeCode: 'seller' }],
        [30, { schemeCode: 'operator' }],
    ]);
    const plans = new Map([[10, 100], [20, 100], [30, 100]]);

    it('топ-1 по конверсии внутри когорты + порог плана: только лучший зачтён', () => {
        const managers = [
            make(10, { revenue: 100, conversionPct: 50 }), // план 100%, конверсия лучшая → зачтён
            make(20, { revenue: 100, conversionPct: 30 }), // план 100%, но конверсия не топ → нет
        ];
        const res = evaluateMonth(POLICY, managers, comp, plans);
        const a = res.find((r) => r.managerId === 10)!;
        const b = res.find((r) => r.managerId === 20)!;
        expect(a.qualified).toBe(true);
        expect(b.qualified).toBe(false);
        expect(b.criteria.find((c) => c.metric === 'conversion')!.passed).toBe(false);
    });

    it('когорты независимы: лучший в своей роли — топ даже в одиночку', () => {
        const managers = [
            make(10, { revenue: 50, conversionPct: 50 }), // план 50% → не проходит порог
            make(30, { revenue: 100, conversionPct: 10 }), // одиночка в operator: топ-1 + план 100% → зачтён
        ];
        const res = evaluateMonth(POLICY, managers, comp, plans);
        expect(res.find((r) => r.managerId === 30)!.qualified).toBe(true);
        expect(res.find((r) => r.managerId === 10)!.qualified).toBe(false); // план не выполнен
    });

    it('нулевая метрика не делает «лучшим» (dept_rank требует value > 0)', () => {
        const managers = [make(10, { revenue: 100, conversionPct: 0 })];
        const res = evaluateMonth(POLICY, managers, comp, plans);
        expect(res[0].criteria.find((c) => c.metric === 'conversion')!.passed).toBe(false);
        expect(res[0].qualified).toBe(false);
    });
});

// ── Приз месяца ─────────────────────────────────────────────────────────────
// Гейт (выполнение личного плана) отсекает участников; среди прошедших место
// решает приоритет показателей: ОКК → конверсия → средний чек.
const PRIZE_POLICY: GradePolicy = {
    mode: 'monthly_prize',
    floorLevel: 3,
    topLevel: 1,
    lookbackMonths: 6,
    promoteAfterMonths: 3,
    demoteAfterMonths: 2,
    cohort: 'register',
    criteria: [],
    prize: {
        gate: { metric: 'plan_attainment', comparator: 'gte', threshold: 100 },
        tiebreak: ['okk_total_score', 'conversion', 'avg_check'],
    },
};

describe('evaluatePrizeMonth — приз месяца', () => {
    const comp = new Map([
        [10, { schemeCode: 'seller' }],
        [20, { schemeCode: 'seller' }],
        [30, { schemeCode: 'seller' }],
    ]);
    const plans = new Map([[10, 100], [20, 100], [30, 100]]);
    const byId = (res: { managerId: number }[], id: number) => res.find((r) => r.managerId === id)!;

    it('гейт не прошёл никто → все на полу, приза нет', () => {
        const managers = [
            make(10, { revenue: 90, quality: 60 }),
            make(20, { revenue: 80, quality: 55 }),
            make(30, { revenue: 50, quality: 50 }),
        ];
        const res = evaluatePrizeMonth(PRIZE_POLICY, managers, comp, plans);
        expect(res.every((r) => r.level === 3)).toBe(true);
        expect(res.every((r) => r.place === null)).toBe(true);
    });

    it('прошли двое → приз и второе место, не прошедший на полу', () => {
        const managers = [
            make(10, { revenue: 130, quality: 50 }),
            make(20, { revenue: 120, quality: 40 }),
            make(30, { revenue: 90, quality: 99 }), // ОКК лучший, но план не сделан → вне игры
        ];
        const res = evaluatePrizeMonth(PRIZE_POLICY, managers, comp, plans);
        expect(byId(res, 10)).toMatchObject({ place: 1, level: 1, gatePassed: true });
        expect(byId(res, 20)).toMatchObject({ place: 2, level: 2, gatePassed: true });
        expect(byId(res, 30)).toMatchObject({ place: null, level: 3, gatePassed: false });
    });

    it('приоритет показателей: первый решает, конверсия не спасает', () => {
        const managers = [
            make(10, { revenue: 110, quality: 40, conversionPct: 90 }),
            make(20, { revenue: 110, quality: 50, conversionPct: 10 }),
        ];
        const res = evaluatePrizeMonth(PRIZE_POLICY, managers, comp, plans);
        expect(byId(res, 20).place).toBe(1);
        expect(byId(res, 10).place).toBe(2);
    });

    it('при равенстве первого показателя решает следующий', () => {
        const managers = [
            make(10, { revenue: 110, quality: 50, conversionPct: 20 }),
            make(20, { revenue: 110, quality: 50, conversionPct: 30 }),
        ];
        const res = evaluatePrizeMonth(PRIZE_POLICY, managers, comp, plans);
        expect(byId(res, 20).place).toBe(1);
        expect(byId(res, 10).place).toBe(2);
    });

    it('уровень не уходит ниже пола: третье место уже на полу', () => {
        const managers = [
            make(10, { revenue: 130, quality: 60 }),
            make(20, { revenue: 130, quality: 50 }),
            make(30, { revenue: 130, quality: 40 }),
        ];
        const res = evaluatePrizeMonth(PRIZE_POLICY, managers, comp, plans);
        expect(byId(res, 30)).toMatchObject({ place: 3, level: 3 });
    });

    it('менеджер реестра без метрик за месяц уходит на пол', () => {
        const managers = [make(10, { revenue: 130, quality: 60 })];
        const res = evaluatePrizeMonth(PRIZE_POLICY, managers, comp, plans);
        expect(res).toHaveLength(3); // считаем по реестру, а не по тем, у кого есть заказы
        expect(byId(res, 20)).toMatchObject({ place: null, level: 3, gatePassed: false });
    });

    it('когорта «та же роль»: в каждой роли свой приз', () => {
        const policy: GradePolicy = { ...PRIZE_POLICY, cohort: 'scheme' };
        const compByRole = new Map([
            [10, { schemeCode: 'seller' }],
            [20, { schemeCode: 'seller' }],
            [30, { schemeCode: 'operator' }],
        ]);
        const managers = [
            make(10, { revenue: 130, quality: 60 }),
            make(20, { revenue: 130, quality: 50 }),
            make(30, { revenue: 130, quality: 10 }), // слабее всех, но один в своей роли
        ];
        const res = evaluatePrizeMonth(policy, managers, compByRole, plans);
        expect(byId(res, 10).place).toBe(1);
        expect(byId(res, 30).place).toBe(1); // приз внутри роли operator
        expect(byId(res, 30).level).toBe(1);
    });
});

describe('assignMonthlyPrize — чистая раздача мест', () => {
    it('при полном равенстве показателей порядок детерминирован (по managerId)', () => {
        const entrants = [
            { managerId: 20, cohort: 'all', gateValue: 120, gatePassed: true, scores: [50, 30] },
            { managerId: 10, cohort: 'all', gateValue: 120, gatePassed: true, scores: [50, 30] },
        ];
        const a = assignMonthlyPrize(PRIZE_POLICY, entrants);
        const b = assignMonthlyPrize(PRIZE_POLICY, [...entrants].reverse());
        expect(a.find((r) => r.managerId === 10)!.place).toBe(1);
        expect(b.find((r) => r.managerId === 10)!.place).toBe(1);
    });
});
