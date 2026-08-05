import { pickTier, round2 } from '@/lib/salary/blocks/tiers';
import type { TariffLine } from '@/lib/salary/blocks/types';

// ============================================================================
// Хелперы для «тарифа» блока — ставок/порогов/ступеней из params (БД) в
// человеческом виде. Числа НЕ придумываем: сюда приходят только параметры схемы.
// ============================================================================

export const tRub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
export const tPct = (n: number) => `${round2(Number(n) || 0)}%`;

/**
 * Ступенчатая шкала → строки тарифа. `current` — текущее значение метрики
 * (null = нет данных): по нему помечается активная ступень.
 */
export function tierLines<T extends { min: number }>(
    tiers: T[],
    fmtMin: (min: number) => string,
    fmtOut: (t: T) => string,
    current: number | null,
): TariffLine[] {
    const sorted = [...tiers].sort((a, b) => a.min - b.min);
    const act = current == null ? null : pickTier(current, sorted);
    return sorted.map((t) => ({ label: `от ${fmtMin(t.min)}`, value: fmtOut(t), active: act === t }));
}

/** Порог «прошёл / не прошёл» одной строкой: условие → бонус. */
export function thresholdLine(condition: string, bonus: number, passed: boolean): TariffLine {
    return { label: condition, value: tRub(bonus), active: passed };
}
