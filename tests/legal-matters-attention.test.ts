import { describe, expect, it } from 'vitest';
import { buildAttentionList, buildSummary, collectReasons } from '@/lib/legal-matters/attention';
import { calcFinancialRisk } from '@/lib/legal-matters/money';
import { evaluateDeadlines } from '@/lib/legal-matters/deadlines';
import type { MatterRow } from '@/lib/legal-matters/repo';

const today = new Date('2026-09-28T00:00:00Z');

function makeMatter(patch: Record<string, any> = {}): MatterRow {
  const base: any = {
    id: 1,
    matter_no: '2026-001',
    matter_side: 'respondent',
    stage: 'claim',
    status: 'in_work',
    opened_on: '2026-09-01',
    closed_on: null,
    next_action: 'Подготовить ответ',
    next_action_due: '2026-10-05',
    ...patch,
  };

  return {
    ...base,
    last_event: null,
    risk: calcFinancialRisk(base),
    deadlines: evaluateDeadlines(base, today),
  } as MatterRow;
}

describe('что требует внимания', () => {
  it('истёкшая давность острее просроченного действия', () => {
    const expired = makeMatter({ id: 1, limitation_until: '2026-08-01' });
    const overdue = makeMatter({ id: 2, next_action_due: '2026-09-20' });

    const list = buildAttentionList([overdue, expired]);

    expect(list[0].matter.id).toBe(1);
    expect(list[0].reasons).toContain('limitation_expired');
  });

  it('при равной остроте вперёд идёт дело с большей суммой на кону', () => {
    const cheap = makeMatter({ id: 1, next_action_due: '2026-09-20', claim_amount_kopecks: 1_000_000 });
    const pricey = makeMatter({ id: 2, next_action_due: '2026-09-20', claim_amount_kopecks: 90_000_000 });

    const list = buildAttentionList([cheap, pricey]);

    expect(list[0].matter.id).toBe(2);
  });

  it('дело без следующего действия попадает в список', () => {
    const matter = makeMatter({ next_action: null, next_action_due: null });
    expect(collectReasons(matter)).toContain('action_missing');
  });

  it('спокойное дело в список не попадает', () => {
    const list = buildAttentionList([makeMatter()]);
    expect(list).toHaveLength(0);
  });

  it('закрытые дела не тревожат, даже если сроки прошли', () => {
    const matter = makeMatter({ status: 'closed', closed_on: '2026-09-10', next_action_due: '2026-01-01' });
    expect(buildAttentionList([matter])).toHaveLength(0);
  });

  it('давность и просрочка вместе дают больший вес, чем по отдельности', () => {
    const both = makeMatter({ id: 1, limitation_until: '2026-10-20', next_action_due: '2026-09-01' });
    const one = makeMatter({ id: 2, limitation_until: '2026-10-20' });

    const list = buildAttentionList([one, both]);

    expect(list[0].matter.id).toBe(1);
    expect(list[0].reasons).toEqual(['limitation_soon', 'action_overdue']);
  });
});

describe('сводка для руководителя', () => {
  it('считает открытые, суды, взыскание и сумму риска', () => {
    const matters = [
      makeMatter({ id: 1, stage: 'court', claim_amount_kopecks: 10_000_000 }),
      makeMatter({ id: 2, stage: 'enforcement', claim_amount_kopecks: 5_000_000 }),
      makeMatter({ id: 3, status: 'closed', closed_on: '2026-09-01', claim_amount_kopecks: 99_000_000 }),
    ];

    const summary = buildSummary(matters);

    expect(summary.total).toBe(3);
    expect(summary.open).toBe(2);
    expect(summary.inCourt).toBe(1);
    expect(summary.inEnforcement).toBe(1);
    expect(summary.riskKopecks).toBe(15_000_000);
  });

  it('закрытые дела в сумму риска не входят', () => {
    const summary = buildSummary([
      makeMatter({ id: 1, status: 'closed', closed_on: '2026-09-01', claim_amount_kopecks: 50_000_000 }),
    ]);

    expect(summary.riskKopecks).toBe(0);
  });
});
