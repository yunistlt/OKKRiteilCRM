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
    grade_multiplier: { tiers: [{ level: 1, k: 1.25 }, { level: 2, k: 1.1 }, { level: 3, k: 1.0 }] },
    plan_attainment: { thresholdPct: 100, bonus: 10000 },
    plan_accelerator: { perPercent: 500 },
    plan_coef: { tiers: [{ min: 120, k: 1.2 }, { min: 100, k: 1.1 }, { min: 90, k: 1.0 }, { min: 0, k: 0.8 }] },
    dept_plan_coef: { tiers: [{ min: 110, k: 1.15 }, { min: 100, k: 1.0 }, { min: 0, k: 0.9 }] },
    volume_bonus: { threshold: 3000000, bonus: 10000 },
    same_day_sale: { rate: 500 },
    // Пороги — плейсхолдер под текущую задачу бизнеса (доплата за 3-ю и 6-ю покупку).
    // Строки добавляются/удаляются в конструкторе: платить можно за любую по счёту.
    repeat_client_bonus: { tiers: [{ ordinal: 3, bonus: 10000 }, { ordinal: 6, bonus: 15000 }], minDaysBetween: 14 },
    script_bonus: { thresholdPct: 80, bonus: 5000 },
    fast_contact_bonus: { thresholdPct: 80, bonus: 5000 },
    fields_bonus: { thresholdPct: 80, bonus: 3000 },
    // Плейсхолдеры для конструктора: percent и нормативы бизнес задаёт пофамильно.
    // slaNormy в часах (фаза 1 — календарные), kTiers по отношению факт/норма.
    procent_za_raschet: {
        percent: 1,
        slaNormy: [
            { maxSum: 500000, normHours: 24 },
            { maxSum: 2000000, normHours: 48 },
            { maxSum: 5000000, normHours: 72 },
            { maxSum: 1000000000, normHours: 72 },
        ],
        kTiers: [
            { maxRatio: 0.5, k: 1.15 },
            { maxRatio: 1.0, k: 1.0 },
            { maxRatio: 1.5, k: 0.9 },
            { maxRatio: 9999, k: 0.8 },
        ],
        kMissing: 1.0,
    },
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
        scope: b.scope ?? 'manager',
        requiredMetrics: b.requiredMetrics,
        defaultParams: DEFAULT_BLOCK_PARAMS[b.code] ?? {},
        // блок доступен в конструкторе, только если ВСЕ его метрики есть в БД
        available: b.requiredMetrics.every(isMetricAvailable),
    }));
}
