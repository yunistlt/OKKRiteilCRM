import { describe, expect, it } from 'vitest';
import { getBlock } from '@/lib/salary/blocks/registry';

// Ниже самого нижнего порога тира нет — коэффициент должен быть 0, а не 1.
// Инцидент 13.10.2026: при 2% плана премии выплачивались полностью, при 51% — сгорали.
describe('plan_coef: факт ниже нижнего порога', () => {
    const block: any = getBlock('plan_coef');
    const tiers = [{ min: 100, k: 1.1 }, { min: 80, k: 1 }, { min: 60, k: 0.9 }, { min: 50, k: 0 }];
    const metrics = (revenueNoVat: number) => ({ countedOrders: [{ revenueNoVat }] }) as any;

    it('2% личного плана → ×0', () => {
        expect(block.compute(metrics(81_454), { tiers }, { personalPlanTarget: 4_800_000 } as any).multiplier).toBe(0);
    });

    it('61% личного плана → ×0.9', () => {
        expect(block.compute(metrics(2_928_000), { tiers }, { personalPlanTarget: 4_800_000 } as any).multiplier).toBe(0.9);
    });

    it('план не задан → ×1 (не режем)', () => {
        expect(block.compute(metrics(81_454), { tiers }, { personalPlanTarget: null } as any).multiplier).toBe(1);
    });
});
