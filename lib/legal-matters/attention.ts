// Экран руководителя: «что требует внимания».
//
// Смысл раздела не в списке дел, а в ответе на вопрос «где юридическая функция
// требует вмешательства прямо сейчас». Поэтому дела не просто фильтруются, а
// ранжируются по остроте: сначала то, что уже нельзя откладывать.
import type { MatterRow } from './repo';

/** Причины попадания в список. Порядок = приоритет, первый элемент острее. */
export const ATTENTION_REASONS = [
  'limitation_expired',
  'limitation_soon',
  'action_overdue',
  'reply_overdue',
  'action_missing',
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

const REASON_WEIGHT: Record<AttentionReason, number> = {
  limitation_expired: 100,
  limitation_soon: 80,
  action_overdue: 60,
  reply_overdue: 50,
  action_missing: 30,
};

export type AttentionItem = {
  matter: MatterRow;
  reasons: AttentionReason[];
  /** Чем больше, тем выше в списке. */
  weight: number;
};

export function collectReasons(matter: MatterRow): AttentionReason[] {
  const state = matter.deadlines;
  const reasons: AttentionReason[] = [];

  if (state.limitationExpired) reasons.push('limitation_expired');
  else if (state.limitationSoon) reasons.push('limitation_soon');
  if (state.actionOverdue) reasons.push('action_overdue');
  if (state.replyOverdue) reasons.push('reply_overdue');
  if (state.actionMissing) reasons.push('action_missing');

  return reasons;
}

/**
 * Дела, требующие внимания, от самого острого.
 *
 * При равной остроте вперёд идёт дело с большей суммой на кону: из двух
 * одинаково просроченных первым разбирают то, где дороже ошибка.
 */
export function buildAttentionList(matters: MatterRow[]): AttentionItem[] {
  return matters
    .filter((matter) => !matter.closed_on && matter.status !== 'closed')
    .map((matter) => {
      const reasons = collectReasons(matter);
      const weight = reasons.reduce((sum, reason) => sum + REASON_WEIGHT[reason], 0);
      return { matter, reasons, weight };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return right.matter.risk.totalKopecks - left.matter.risk.totalKopecks;
    });
}

export type MattersSummary = {
  total: number;
  open: number;
  needAttention: number;
  inCourt: number;
  inEnforcement: number;
  riskKopecks: number;
};

/** Шесть показателей наверху экрана — ровно те, что просили. */
export function buildSummary(matters: MatterRow[]): MattersSummary {
  const open = matters.filter((matter) => !matter.closed_on && matter.status !== 'closed');

  return {
    total: matters.length,
    open: open.length,
    needAttention: buildAttentionList(matters).length,
    inCourt: open.filter((matter) => matter.stage === 'court' || matter.stage === 'appeal').length,
    inEnforcement: open.filter((matter) => matter.stage === 'enforcement').length,
    riskKopecks: open.reduce((sum, matter) => sum + matter.risk.totalKopecks, 0),
  };
}
