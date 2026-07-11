import { describe, it, expect } from 'vitest';
import { extractInvoiceNumbers } from '@/lib/payments/matching';
import { parseAmountToKopecks } from '@/lib/payments/types';
import { normalizeTochkaPayment, isIncomingTochkaWebhook } from '@/lib/payments/tochka';

describe('extractInvoiceNumbers', () => {
  it('вытаскивает номер счёта из реального назначения', () => {
    expect(
      extractInvoiceNumbers('ОПЛАТА ПО СЧЕТУ №53433 ОТ 08.06.2026Г СУММА 484898-30В Т.Ч. НДС(5%) 23090-40'),
    ).toEqual(['53433']);
  });

  it('счёт и договор с одинаковым номером не дублируются', () => {
    const res = extractInvoiceNumbers(
      'Окончательная по счету № 53016 от 06.05.2026, к дог.купли-продажи № 53016 от 05.05.2026 г., за товар.',
    );
    expect(res).toContain('53016');
    expect(res.filter((x) => x === '53016')).toHaveLength(1);
  });

  it('счёт с дробью даёт полный номер и базу', () => {
    const res = extractInvoiceNumbers('Оплата по счету № 1007/2 от 10 июля 2026 г. - Стульчик');
    expect(res).toContain('1007/2');
    expect(res).toContain('1007');
    expect(res.indexOf('1007/2')).toBeLessThan(res.indexOf('1007'));
  });

  it('пустое назначение — пустой массив', () => {
    expect(extractInvoiceNumbers(null)).toEqual([]);
    expect(extractInvoiceNumbers('')).toEqual([]);
    expect(extractInvoiceNumbers('Просто перевод без номера')).toEqual([]);
  });
});

describe('parseAmountToKopecks', () => {
  it('число в рублях → копейки', () => {
    expect(parseAmountToKopecks(484898.3)).toBe(48489830);
    expect(parseAmountToKopecks(47980)).toBe(4798000);
  });
  it('строка с точкой/запятой/дефисом', () => {
    expect(parseAmountToKopecks('484898.30')).toBe(48489830);
    expect(parseAmountToKopecks('484 898,30')).toBe(48489830);
    expect(parseAmountToKopecks('484898-30')).toBe(48489830);
  });
  it('мусор → null', () => {
    expect(parseAmountToKopecks('abc')).toBeNull();
    expect(parseAmountToKopecks(null)).toBeNull();
  });
});

describe('isIncomingTochkaWebhook', () => {
  it('различает входящие и прочие события', () => {
    expect(isIncomingTochkaWebhook('incomingPayment')).toBe(true);
    expect(isIncomingTochkaWebhook('incomingSbpPayment')).toBe(true);
    expect(isIncomingTochkaWebhook('outgoingPayment')).toBe(false);
    expect(isIncomingTochkaWebhook('acquiringInternetPayment')).toBe(false);
    expect(isIncomingTochkaWebhook(null)).toBe(false);
  });
});

describe('normalizeTochkaPayment', () => {
  it('нормализует входящий платёж юрлица', () => {
    const payload = {
      webhookType: 'incomingPayment',
      customerCode: '300000000',
      paymentId: '10730323',
      amount: '484898.30',
      purpose: 'ОПЛАТА ПО СЧЕТУ №53433 ОТ 08.06.2026Г',
      date: '2026-07-10',
      payerName: 'ООО "АГРОПРОМСЕРВИС"',
      payerInn: '463217526',
      documentNumber: '3685',
    };
    const n = normalizeTochkaPayment(payload, true);
    expect(n).not.toBeNull();
    expect(n!.externalPaymentId).toBe('10730323');
    expect(n!.amountKopecks).toBe(48489830);
    expect(n!.payerInn).toBe('463217526');
    expect(n!.paymentDate).toBe('2026-07-10');
    expect(n!.signatureVerified).toBe(true);
  });

  it('распознаёт реальную структуру Точки (сумма/плательщик в SidePayer)', () => {
    // Формат из боевого тестового вебхука Точки (test_send).
    const payload = {
      SidePayer: {
        bankCode: '044525104',
        bankName: 'ООО Банк Точка',
        account: '40802810000000000001',
        name: 'ИП Тест',
        amount: '40.0',
        currency: 'RUB',
        inn: '1234567890',
        kpp: '0',
      },
      SideRecipient: {
        account: '40802810620000000009',
        name: 'ЗВТО АО',
        amount: '40.0',
        currency: 'RUB',
      },
      purpose: 'Оплата по счету № 53433',
      documentNumber: '3685',
      paymentId: '10730323',
      date: '2026-07-10',
      webhookType: 'incomingPayment',
      customerCode: '300117921',
    };
    const n = normalizeTochkaPayment(payload, true);
    expect(n).not.toBeNull();
    expect(n!.amountKopecks).toBe(4000); // 40.0 руб
    expect(n!.payerName).toBe('ИП Тест');
    expect(n!.payerInn).toBe('1234567890');
    expect(n!.payerBankBic).toBe('044525104');
    expect(n!.accountId).toBe('40802810620000000009');
    expect(n!.purpose).toContain('53433');
  });

  it('исходящий платёж игнорируется (null)', () => {
    expect(normalizeTochkaPayment({ webhookType: 'outgoingPayment', paymentId: '1', amount: '10' }, true)).toBeNull();
  });

  it('без paymentId или суммы — null', () => {
    expect(normalizeTochkaPayment({ webhookType: 'incomingPayment', amount: '10' }, true)).toBeNull();
    expect(normalizeTochkaPayment({ webhookType: 'incomingPayment', paymentId: '1' }, true)).toBeNull();
  });
});
