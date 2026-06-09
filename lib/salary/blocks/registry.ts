import { CORE_BLOCKS } from '@/lib/salary/blocks/core-blocks';
import { isMetricAvailable } from '@/lib/salary/blocks/metrics-catalog';
import type { BonusBlock } from '@/lib/salary/blocks/types';

// ============================================================================
// Каталог блоков. Реестр собирается из реализаций; на Фазе 2 сюда добавятся
// остальные блоки (план, объём, скрипт и т.д.). Фаза 1 — только ядровые.
// ============================================================================

const ALL_BLOCKS: BonusBlock[] = [...CORE_BLOCKS];

export const BLOCK_REGISTRY: Record<string, BonusBlock> = Object.fromEntries(ALL_BLOCKS.map((b) => [b.code, b]));

export function getBlock(code: string): BonusBlock | undefined {
    return BLOCK_REGISTRY[code];
}

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
        // блок доступен в конструкторе, только если ВСЕ его метрики есть в БД
        available: b.requiredMetrics.every(isMetricAvailable),
    }));
}
