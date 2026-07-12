// Подбор тира по значению: берём тир с наибольшим min, который <= value.
// Вынесено отдельно, чтобы и движок, и блоки использовали одну реализацию без цикла импортов.
export type Tier = { min: number };

export function pickTier<T extends Tier>(value: number, tiers: T[]): T | null {
    const sorted = [...tiers].sort((a, b) => b.min - a.min);
    for (const t of sorted) {
        if (value >= t.min) return t;
    }
    return null;
}

// Следующий тир вверх: тир с наименьшим min, СТРОГО большим value (ближайшая ступень
// выше текущей). null — value уже на верхнем тире (расти некуда).
export function nextTier<T extends Tier>(value: number, tiers: T[]): T | null {
    const above = tiers.filter((t) => t.min > value).sort((a, b) => a.min - b.min);
    return above[0] ?? null;
}

export function round2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
}
