import { describe, it, expect } from 'vitest';
import { confirmingSignals } from '@/lib/payments/matching';
import type { NormalizedPointPayment } from '@/lib/payments/types';

// Подтверждающие сигналы «платёж про этот заказ». Фикстура — реальный случай 01.08.2026:
// заказ 53338 на 474 049,40 ₽, приход 331 834,58 ₽ (ровно 70% предоплаты) от ООО «ЮИ ТРЕЙД»,
// в назначении счёт «5333» — на цифру короче номера заказа.
const payment = (over: Partial<NormalizedPointPayment> = {}): NormalizedPointPayment =>
  ({
    source: 'tbank',
    externalPaymentId: 'x',
    amountKopecks: 33183458,
    currency: 'RUB',
    paymentDate: '2026-07-22',
    paymentDatetime: '2026-07-22T12:04:29+03:00',
    purpose: 'Оплата по счету № 5333 от 13.07.2026 Сумма 331834-58 В т.ч. НДС (5%) 15801-65',
    payerName: 'ООО "ЮИ ТРЕЙД"',
    payerInn: '5047313270',
    recipientInn: '6324017492',
    signatureVerified: true,
    rawPayload: {},
    ...over,
  }) as NormalizedPointPayment;

const order = (over: Record<string, any> = {}) => ({
  order_id: 53338,
  number: '53338',
  status: 'prepayed',
  totalsumm: 474049.4,
  created_at: '2026-05-20T10:00:00+03:00',
  raw_payload: { contragent: { INN: '5047313270' }, customer: { nickName: 'Юнайтед Индастриал' } },
  ...over,
});

describe('confirmingSignals', () => {
  it('боевой случай 53338: ИНН + доля предоплаты = два сигнала (порог автопривязки)', () => {
    const signals = confirmingSignals(order(), payment());
    expect(signals).toContain('ИНН плательщика');
    expect(signals).toContain('70% суммы заказа');
    // «5333» ≠ «53338»: похожий номер — якорь поиска, а не подтверждение.
    expect(signals).not.toContain('номер счёта');
    expect(signals.length).toBeGreaterThanOrEqual(2);
  });

  it('точный номер счёта в назначении — отдельный сигнал', () => {
    const signals = confirmingSignals(
      order(),
      payment({ purpose: 'Оплата по счету № 53338 от 13.07.2026' }),
    );
    expect(signals).toContain('номер счёта');
  });

  it('без ИНН в заказе остаётся сигнал доли и номера — привязка всё ещё возможна', () => {
    const signals = confirmingSignals(order({ raw_payload: {} }), payment());
    expect(signals).not.toContain('ИНН плательщика');
    expect(signals).toContain('70% суммы заказа');
  });

  it('чужой заказ того же контрагента без совпадений по сумме и номеру даёт один сигнал', () => {
    const signals = confirmingSignals(
      order({ order_id: 53336, number: '53336', totalsumm: 3380400 }),
      payment(),
    );
    expect(signals).toEqual(['ИНН плательщика']); // одного мало — уйдёт человеку на подтверждение
  });

  it('точная сумма заказа — отдельный сигнал, не путается с долей', () => {
    const signals = confirmingSignals(order({ totalsumm: 331834.58 }), payment());
    expect(signals).toContain('сумма заказа');
    expect(signals.some((s) => s.endsWith('% суммы заказа'))).toBe(false);
  });

  it('оплата больше суммы заказа сигналом по сумме не считается', () => {
    const signals = confirmingSignals(order({ totalsumm: 100000 }), payment());
    expect(signals.some((s) => s.includes('суммы заказа') || s === 'сумма заказа')).toBe(false);
  });

  it('дата счёта из назначения рядом с датой заказа — сигнал', () => {
    const signals = confirmingSignals(order({ created_at: '2026-07-14T09:00:00+03:00' }), payment());
    expect(signals).toContain('дата счёта');
  });
});
