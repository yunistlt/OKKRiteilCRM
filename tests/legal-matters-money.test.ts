import { describe, expect, it } from 'vitest';
import { calcFinancialRisk, sumFinancialRisk } from '@/lib/legal-matters/money';
import { evaluateDeadlines, resolveLimitationUntil } from '@/lib/legal-matters/deadlines';

describe('финансовый риск по делу', () => {
  it('с нас требуют: складывает требование, неустойку, убытки и расходы', () => {
    const risk = calcFinancialRisk({
      matter_side: 'respondent',
      claim_amount_kopecks: 48_000_000,
      penalty_kopecks: 5_000_000,
      damages_kopecks: 10_000_000,
      court_costs_kopecks: 3_500_000,
    });

    expect(risk.totalKopecks).toBe(66_500_000);
    expect(risk.parts).toHaveLength(4);
  });

  it('вычитает урегулированное и уже выплаченное', () => {
    const risk = calcFinancialRisk({
      matter_side: 'respondent',
      claim_amount_kopecks: 48_000_000,
      settled_amount_kopecks: 10_000_000,
      paid_out_kopecks: 8_000_000,
    });

    expect(risk.totalKopecks).toBe(30_000_000);
  });

  it('требуем мы: считает недополученное, взысканное вычитает', () => {
    const risk = calcFinancialRisk({
      matter_side: 'claimant',
      our_claim_amount_kopecks: 195_228_700,
      state_duty_kopecks: 3_000_000,
      recovered_kopecks: 100_000_000,
    });

    expect(risk.totalKopecks).toBe(98_228_700);
  });

  it('взыскали больше требования — на кону ноль, а не минус', () => {
    const risk = calcFinancialRisk({
      matter_side: 'claimant',
      our_claim_amount_kopecks: 10_000_000,
      recovered_kopecks: 25_000_000,
    });

    expect(risk.totalKopecks).toBe(0);
  });

  it('раскладка возвращает только заполненные слагаемые', () => {
    const risk = calcFinancialRisk({
      matter_side: 'respondent',
      claim_amount_kopecks: 1_000_000,
      penalty_kopecks: 0,
    });

    expect(risk.parts.map((part) => part.field)).toEqual(['claim_amount_kopecks']);
  });

  it('сумма риска по делам складывается', () => {
    const total = sumFinancialRisk([
      { matter_side: 'respondent', claim_amount_kopecks: 1_000_000 },
      { matter_side: 'claimant', our_claim_amount_kopecks: 2_000_000 },
    ]);

    expect(total).toBe(3_000_000);
  });
});

describe('сроки по делу', () => {
  const today = new Date('2026-09-28T00:00:00Z');

  it('давность считается от возникновения права требования — три года', () => {
    expect(resolveLimitationUntil({ claim_right_on: '2025-01-15' })).toBe('2028-01-15');
  });

  it('заданная руками дата давности важнее вычисленной', () => {
    expect(
      resolveLimitationUntil({ claim_right_on: '2025-01-15', limitation_until: '2026-01-15' }),
    ).toBe('2026-01-15');
  });

  it('ловит просроченное действие', () => {
    const state = evaluateDeadlines({ next_action: 'Подготовить иск', next_action_due: '2026-09-20' }, today);
    expect(state.actionOverdue).toBe(true);
    expect(state.actionDueInDays).toBe(-8);
  });

  it('предупреждает о давности заранее, а не по факту', () => {
    const state = evaluateDeadlines({ limitation_until: '2026-11-01' }, today);
    expect(state.limitationSoon).toBe(true);
    expect(state.limitationExpired).toBe(false);
  });

  it('закрытое дело сроками не тревожит', () => {
    const state = evaluateDeadlines(
      { status: 'closed', closed_on: '2026-09-01', next_action_due: '2026-01-01', limitation_until: '2026-01-01' },
      today,
    );
    expect(state.actionOverdue).toBe(false);
    expect(state.limitationExpired).toBe(false);
    expect(state.actionMissing).toBe(false);
  });

  it('активное дело без следующего действия — дыра', () => {
    const state = evaluateDeadlines({ status: 'in_work' }, today);
    expect(state.actionMissing).toBe(true);
  });

  it('ловит просроченный ответ на претензию', () => {
    const state = evaluateDeadlines({ claim_reply_due: '2026-09-25' }, today);
    expect(state.replyOverdue).toBe(true);
  });
});
