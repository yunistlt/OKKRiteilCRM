import { getBlock } from '@/lib/salary/blocks/registry';
import { round2 } from '@/lib/salary/blocks/tiers';
import type { BlockComputeContext, BlockContribution, BlockInstance } from '@/lib/salary/blocks/types';
import type { ManagerMetrics } from '@/lib/salary/metrics';

// ============================================================================
// Сборка вкладов блоков в итог. Алгоритм (см. план):
//   base    = Σ amount(group=base, не множитель/штраф)
//   premia  = Σ amount(group=premia, ...)
//   variable= Σ amount(group=variable, ...)
//   duty    = Σ amount(group=duty, ...)
//   penalty = Σ amount(kind=penalty)
//   mPremia = Π multiplier(scope=premia)
//   mTeam   = Π multiplier(scope=variableBracket)
//   total   = base + (premia*mPremia + variable)*mTeam + duty + penalty
// Под пресетом «Продавец» тождественно прежней формуле движка.
// ============================================================================

export interface ComposeResult {
    total: number;
    base: number;
    premia: number;
    premiaAfter: number;
    variable: number;
    flat: number;
    duty: number;
    penalty: number;
    mPremia: number;
    mTeam: number;
    variablePart: number; // (premiaAfter + variable) * mTeam — для обратной совместимости breakdown
    contributions: BlockContribution[];
}

export function compose(instances: BlockInstance[], m: ManagerMetrics, ctx: BlockComputeContext): ComposeResult {
    const contributions: BlockContribution[] = [];

    for (const inst of instances) {
        const block = getBlock(inst.code);
        if (!block) continue; // неизвестный код — пропускаем (защита от рассинхрона каталога)
        const params = block.paramSchema.parse(inst.params ?? {}); // валидация параметров
        const res = block.compute(m, params, ctx);
        contributions.push({
            code: block.code,
            name: block.name,
            kind: block.kind,
            group: block.group,
            multiplierScope: block.multiplierScope,
            amount: res.amount,
            multiplier: res.multiplier,
            explain: res.explain,
            dataFill: res.dataFill,
        });
    }

    const sumAdditive = (group: string) =>
        contributions.filter((c) => c.kind !== 'multiplier' && c.kind !== 'penalty' && c.group === group).reduce((s, c) => s + (c.amount || 0), 0);
    const prodMult = (scope: string) =>
        contributions.filter((c) => c.kind === 'multiplier' && c.multiplierScope === scope).reduce((p, c) => p * (c.multiplier ?? 1), 1);

    const base = sumAdditive('base');
    const premia = sumAdditive('premia');
    const variable = sumAdditive('variable');
    const flat = sumAdditive('flat');
    const duty = sumAdditive('duty');
    const penalty = contributions.filter((c) => c.kind === 'penalty').reduce((s, c) => s + (c.amount || 0), 0);

    const mPremia = prodMult('premia');
    const mTeam = prodMult('variableBracket');

    const premiaAfter = premia * mPremia;
    const variablePart = (premiaAfter + variable) * mTeam;
    const total = base + variablePart + flat + duty + penalty;

    return {
        total: round2(total),
        base: round2(base),
        premia: round2(premia),
        premiaAfter: round2(premiaAfter),
        variable: round2(variable),
        flat: round2(flat),
        duty: round2(duty),
        penalty: round2(penalty),
        mPremia,
        mTeam,
        variablePart: round2(variablePart),
        contributions,
    };
}
