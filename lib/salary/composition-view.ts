import type { BlockContribution, CompositionGroup } from '@/lib/salary/blocks/types';

// ============================================================================
// Разбор собранной формулы для ПОЯСНЕНИЙ (отчёт + Семён). Ноль хардкода:
// читает только вклады блоков (blockContributions), повторяя формулу compose.ts:
//   итог = база + (премии×M_премии + переменная)×M_скобки + плоские + штрафы
// Зачем: ставка блока может «действовать», а в итог не попасть — скобку
// обнуляет множитель (например К_личного плана ×0 при недоборе плана).
// Инцидент 10.2026: менеджер видел премию за заявки 25 200 ₽ и премию за
// категории 4 000 ₽ как действующие, а в выплате их не было.
// ============================================================================

export interface MultiplierRef {
    code: string;
    name: string;
    multiplier: number;
    explain: string;
}

export interface CompositionSummary {
    /** Произведение множителей с областью «премии». */
    mPremia: number;
    /** Произведение множителей с областью «вся переменная скобка». */
    mBracket: number;
    premiaMultipliers: MultiplierRef[];
    bracketMultipliers: MultiplierRef[];
    /** Множители, обнуляющие свою область (×0) — именно они «съедают» начисления. */
    zeroing: MultiplierRef[];
}

const toMult = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 1;
};

const toRef = (c: BlockContribution): MultiplierRef => ({
    code: c.code,
    name: c.name,
    multiplier: toMult(c.multiplier),
    explain: c.explain,
});

export function summarizeComposition(contributions: BlockContribution[] = []): CompositionSummary {
    const mults = contributions.filter((c) => c.kind === 'multiplier');
    const premiaMultipliers = mults.filter((c) => c.multiplierScope === 'premia').map(toRef);
    const bracketMultipliers = mults.filter((c) => c.multiplierScope === 'variableBracket').map(toRef);
    const prod = (list: MultiplierRef[]) => list.reduce((p, c) => p * c.multiplier, 1);
    return {
        mPremia: prod(premiaMultipliers),
        mBracket: prod(bracketMultipliers),
        premiaMultipliers,
        bracketMultipliers,
        zeroing: [...premiaMultipliers, ...bracketMultipliers].filter((m) => m.multiplier === 0),
    };
}

/** Во сколько раз начисление блока входит в итог (1 — как есть, 0 — не входит). */
export function factorForGroup(group: CompositionGroup, s: CompositionSummary): number {
    if (group === 'premia') return s.mPremia * s.mBracket;
    if (group === 'variable') return s.mBracket;
    return 1; // база и плоские доплаты вне скобки
}

/** Множители, из-за которых начисление этой группы не доходит до итога. */
export function zeroingFor(group: CompositionGroup, s: CompositionSummary): MultiplierRef[] {
    if (group === 'premia') return s.zeroing;
    if (group === 'variable') return s.bracketMultipliers.filter((m) => m.multiplier === 0);
    return [];
}

/** Сколько рублей блока реально попало в итог. */
export function effectiveAmount(c: BlockContribution, s: CompositionSummary): number {
    if (c.kind === 'multiplier') return 0;
    if (c.kind === 'penalty') return Number(c.amount) || 0;
    return (Number(c.amount) || 0) * factorForGroup(c.group, s);
}
