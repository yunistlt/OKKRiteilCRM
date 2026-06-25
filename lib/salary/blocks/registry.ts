import { CORE_BLOCKS } from '@/lib/salary/blocks/core-blocks';
import { EXTRA_BLOCKS } from '@/lib/salary/blocks/extra-blocks';
import { isMetricAvailable } from '@/lib/salary/blocks/metrics-catalog';
import type { BonusBlock } from '@/lib/salary/blocks/types';

// ============================================================================
// Каталог блоков. Ядровые (формула «Продавца») + дополнительные (план/объём/
// SPIFF/качество). Блок доступен в конструкторе, только если все его метрики
// есть в БД (см. metrics-catalog).
// ============================================================================

const ALL_BLOCKS: BonusBlock[] = [...CORE_BLOCKS, ...EXTRA_BLOCKS];

export const BLOCK_REGISTRY: Record<string, BonusBlock> = Object.fromEntries(ALL_BLOCKS.map((b) => [b.code, b]));

export function getBlock(code: string): BonusBlock | undefined {
    return BLOCK_REGISTRY[code];
}

// Дефолтные параметры для префилла при добавлении блока в схему (UI-конструктор).
export const DEFAULT_BLOCK_PARAMS: Record<string, any> = {
    oklad: { oklad: 35000 },
    premia_zayavki: { rates: { new: 2000, permanent: 1000 } },
    premia_categorii: { rows: [{ category: '', mode: 'sum', value: 0 }] },
    coef_categorii: { rows: [{ category: '', coef: 1 }] },
    k_quality: { tiers: [{ min: 90, k: 1.2 }, { min: 75, k: 1.1 }, { min: 60, k: 1.0 }, { min: 40, k: 0.9 }, { min: 0, k: 0.8 }] },
    conv_bonus: { tiers: [{ min: 45, bonus: 9000 }, { min: 35, bonus: 6000 }, { min: 25, bonus: 3000 }, { min: 0, bonus: 0 }], minZayavki: 10 },
    discount_bonus: { metric: 'avg_order_discount_pct', comparator: 'lte', threshold: 5, bonus: 5000 },
    k_team: { tiers: [{ min: 20000000, k: 1.3 }, { min: 16000000, k: 1.15 }, { min: 12000000, k: 1.0 }, { min: 0, k: 0.5 }] },
    duty: { rate: 250 },
    grade_multiplier: { tiers: [{ level: 1, k: 1.25 }, { level: 2, k: 1.1 }, { level: 3, k: 1.0 }] },
    plan_attainment: { thresholdPct: 100, bonus: 10000 },
    plan_accelerator: { perPercent: 500 },
    plan_gate: { thresholdPct: 80 },
    department_plan_gate: { thresholdPct: 90 },
    plan_coef: { tiers: [{ min: 120, k: 1.2 }, { min: 100, k: 1.1 }, { min: 90, k: 1.0 }, { min: 0, k: 0.8 }] },
    dept_plan_coef: { tiers: [{ min: 110, k: 1.15 }, { min: 100, k: 1.0 }, { min: 0, k: 0.9 }] },
    volume_bonus: { threshold: 3000000, bonus: 10000 },
    same_day_sale: { rate: 500 },
    script_bonus: { thresholdPct: 80, bonus: 5000 },
    fast_contact_bonus: { thresholdPct: 80, bonus: 5000 },
    fields_bonus: { thresholdPct: 80, bonus: 3000 },
};

/** Каталог для UI-конструктора: дескрипторы + доступность данных (без compute). */
export function listBlocks() {
    return ALL_BLOCKS.map((b) => ({
        code: b.code,
        name: b.name,
        methodology: b.methodology,
        kind: b.kind,
        group: b.group,
        multiplierScope: b.multiplierScope,
        requiredMetrics: b.requiredMetrics,
        defaultParams: DEFAULT_BLOCK_PARAMS[b.code] ?? {},
        // блок доступен в конструкторе, только если ВСЕ его метрики есть в БД
        available: b.requiredMetrics.every(isMetricAvailable),
    }));
}
