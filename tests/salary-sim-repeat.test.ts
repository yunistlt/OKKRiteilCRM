/**
 * Сценарий «сколько повторных покупок сделает отдел» в симуляторе ФОТ:
 * количества задаются ползунками в штуках и делятся между менеджерами по доле.
 */
import { describe, it, expect } from 'vitest';
import {
    assignOrdinalsByCount,
    splitCountByShare,
    computeScenarioFot,
    type SimManagerBase,
} from '@/lib/salary/sim-shared';
import type { BlockInstance } from '@/lib/salary/blocks/types';

function base(id: number, share: number, baseOrders: number, baseRevenue: number): SimManagerBase {
    return {
        id, name: `М${id}`, share, baseRevenue, baseOrders,
        countsByType: { new: baseOrders, permanent: 0 },
        countsByCategory: {}, revenueByCategory: {},
        sameDayShare: 0, repeatOrdinalShares: {},
        discountMetricValue: null, qualityAvgScore: null, qualityScriptPct: null,
        fastContactShare: null, fieldsFilledShare: null,
        conversionPct: 0, conversionDenominator: 0, grade: null, planTarget: null,
    };
}

const BLOCKS: BlockInstance[] = [
    { code: 'repeat_client_bonus', params: { tiers: [{ ordinal: 2, bonus: 5000 }, { ordinal: 3, bonus: 10000 }] } },
];

describe('раздача номеров покупок по количествам', () => {
    it('назначает ровно столько заказов, сколько заказано', () => {
        const got = assignOrdinalsByCount(10, { 2: 3, 3: 2 });
        expect(got.filter((x) => x === 2)).toHaveLength(3);
        expect(got.filter((x) => x === 3)).toHaveLength(2);
        expect(got.filter((x) => x === null)).toHaveLength(5);
    });

    it('не назначает больше, чем есть заказов', () => {
        // Повторная покупка — тоже заказ: из 4 заказов не может быть 10 вторых покупок.
        const got = assignOrdinalsByCount(4, { 2: 10 });
        expect(got).toHaveLength(4);
        expect(got.every((x) => x === 2)).toBe(true);
    });

    it('порядок номеров не зависит от порядка ключей', () => {
        expect(assignOrdinalsByCount(4, { 3: 1, 2: 1 })).toEqual([2, 3, null, null]);
    });
});

describe('деление количества между менеджерами', () => {
    it('сумма частей равна заданному количеству', () => {
        const parts = splitCountByShare(7, [0.5, 0.3, 0.2]);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(7);
    });

    it('больше достаётся тому, у кого больше доля', () => {
        const [a, b, c] = splitCountByShare(10, [0.6, 0.3, 0.1]);
        expect(a).toBeGreaterThan(b);
        expect(b).toBeGreaterThan(c);
    });

    it('нулевое количество и нулевые доли не ломают расчёт', () => {
        expect(splitCountByShare(0, [1, 1])).toEqual([0, 0]);
        expect(splitCountByShare(5, [0, 0])).toEqual([0, 0]);
    });
});

describe('ФОТ по сценарию повторных покупок', () => {
    const bases = [base(1, 0.5, 10, 5_000_000), base(2, 0.5, 10, 5_000_000)];
    const scenario = {
        teamRevenue: 10_000_000, deptPlan: 10_000_000, businessDays: 21,
        year: 2026, month: 7, baseTeamRevenue: 10_000_000,
    };

    it('без сценария повторных покупок доплаты нет', () => {
        // repeatOrdinalShares пустые → номера покупок не назначаются.
        const r = computeScenarioFot(BLOCKS, bases, scenario);
        expect(r.total).toBe(0);
    });

    it('заданные количества дают ожидаемую сумму по отделу', () => {
        // 4 вторых × 5 000 + 2 третьих × 10 000 = 40 000
        const r = computeScenarioFot(BLOCKS, bases, { ...scenario, repeatCounts: { 2: 4, 3: 2 } });
        expect(r.total).toBe(40000);
    });

    it('количество делится между менеджерами, а не дублируется', () => {
        const r = computeScenarioFot(BLOCKS, bases, { ...scenario, repeatCounts: { 3: 2 } });
        expect(r.total).toBe(20000); // 2 покупки на отдел, а не по 2 каждому
        expect(r.perManager.map((m) => m.total)).toEqual([10000, 10000]);
    });

    it('рост числа повторных покупок поднимает ФОТ линейно', () => {
        const one = computeScenarioFot(BLOCKS, bases, { ...scenario, repeatCounts: { 3: 2 } }).total;
        const two = computeScenarioFot(BLOCKS, bases, { ...scenario, repeatCounts: { 3: 4 } }).total;
        expect(two).toBe(one * 2);
    });
});
