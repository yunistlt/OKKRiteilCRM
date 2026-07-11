import { describe, it, expect } from 'vitest';
import { getBlock } from '@/lib/salary/blocks/registry';
import type { ManagerMetrics, EngineerOrder } from '@/lib/salary/metrics';
import type { BlockComputeContext } from '@/lib/salary/blocks/types';

// Блок инженера-расчётчика: amount = Σ по заказам( сумма × % × K_срочности ).
// K по отношению факт/норма (норма зависит от суммы); нет данных таймера → kMissing.

const block = getBlock('procent_za_raschet')!;
const ctx = { year: 2026, month: 7, businessDays: 23, teamRevenueNoVat: 0, personalPlanTarget: null, departmentPlanTarget: null, managerGrade: null } as BlockComputeContext;

const PARAMS = {
    percent: 4,
    slaNormy: [
        { maxSum: 500000, normHours: 24 },
        { maxSum: 1_000_000_000, normHours: 72 },
    ],
    kTiers: [
        { maxRatio: 0.5, k: 1.15 },
        { maxRatio: 1.0, k: 1.0 },
        { maxRatio: 1.5, k: 0.9 },
        { maxRatio: 9999, k: 0.8 },
    ],
    kMissing: 1.0,
};

const H = 3600;
const metrics = (orders: EngineerOrder[]) => ({ engineerOrders: orders } as unknown as ManagerMetrics);
const one = (orderSum: number, raschetSeconds: number | null): EngineerOrder => ({ orderId: 1, orderSum, raschetSeconds, enteredAt: '2026-07-05' });

describe('procent_za_raschet', () => {
    it('нет данных таймера → нейтральный K (kMissing)', () => {
        expect(block.compute(metrics([one(100_000, null)]), PARAMS, ctx).amount).toBe(4000); // 100000*0.04*1
    });

    it('K по бэндам (сумма 100k, норма 24ч)', () => {
        expect(block.compute(metrics([one(100_000, 10 * H)]), PARAMS, ctx).amount).toBe(4600); // ratio 0.42 → 1.15
        expect(block.compute(metrics([one(100_000, 20 * H)]), PARAMS, ctx).amount).toBe(4000); // ratio 0.83 → 1.0
        expect(block.compute(metrics([one(100_000, 30 * H)]), PARAMS, ctx).amount).toBe(3600); // ratio 1.25 → 0.9
        expect(block.compute(metrics([one(100_000, 40 * H)]), PARAMS, ctx).amount).toBe(3200); // ratio 1.67 → 0.8
    });

    it('норматив зависит от суммы заказа (2M → норма 72ч)', () => {
        // 36ч / 72ч = 0.5 → 1.15;  2 000 000 × 0.04 × 1.15 = 92 000
        expect(block.compute(metrics([one(2_000_000, 36 * H)]), PARAMS, ctx).amount).toBe(92_000);
    });

    it('суммирует по всем заказам инженера', () => {
        const r = block.compute(metrics([one(100_000, null), one(100_000, 10 * H)]), PARAMS, ctx);
        expect(r.amount).toBe(8600); // 4000 + 4600
        expect(r.dataFill).toEqual({ required: 2, present: 1, pct: 0.5 });
    });

    it('нет заказов → 0', () => {
        expect(block.compute(metrics([]), PARAMS, ctx).amount).toBe(0);
    });
});
