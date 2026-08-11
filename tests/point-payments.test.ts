import { describe, it, expect } from 'vitest';
import { extractInvoiceNumbers } from '@/lib/payments/matching';
import { computeCrmPosting } from '@/lib/payments/service';
import { parseAmountToKopecks } from '@/lib/payments/types';
import { normalizeTochkaPayment, isIncomingTochkaWebhook } from '@/lib/payments/tochka';
import { normalizeStatementTransaction } from '@/lib/payments/tochka-statement';
import { detectForeignProject } from '@/lib/payments/projects';

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

  it('сокращение «сч.» с точкой (реальный кейс, аванс за мебель)', () => {
    expect(
      extractInvoiceNumbers('Аванс по сч. 52721 от 06.07.2026 за мебель. Сумма 167885-42 НДС (5%) 7994-54'),
    ).toEqual(['52721']);
  });

  it('сокращение «сч.» с номером через №', () => {
    expect(extractInvoiceNumbers('Оплата по сч. №49001 за товар')).toEqual(['49001']);
  });

  it('номер расчётного счёта («р/сч 40802…») не считается номером счёта-заказа', () => {
    expect(
      extractInvoiceNumbers('Перевод на р/сч 40802810401500287892 без указания заказа'),
    ).toEqual([]);
  });

  it('пустое назначение — пустой массив', () => {
    expect(extractInvoiceNumbers(null)).toEqual([]);
    expect(extractInvoiceNumbers('')).toEqual([]);
    expect(extractInvoiceNumbers('Просто перевод без номера')).toEqual([]);
  });
});

describe('computeCrmPosting (честное состояние проводки в RetailCRM)', () => {
  const row: any = { source: 'tochka', external_payment_id: 'ABC', amount_kopecks: 16788542, retailcrm_payment_id: '999' };

  it('наш externalId на заказе → posted_auto', () => {
    const order = { payments: { 1: { id: 555, type: 'invoicejur', amount: 167885.42, status: 'check-off-full', externalId: 'tochka-ABC' } } };
    expect(computeCrmPosting(order, row)).toEqual({ posting: 'posted_auto', crmPaymentId: '555' });
  });

  it('нашего нет, но есть ручная оплата на ту же сумму → posted_manual', () => {
    // сумма отличается на 4 копейки (реальный кейс: счёт менеджера 167885.38 vs приход .42)
    const order = { payments: { 1: { id: 51678, type: 'invoicejur', amount: 167885.38, status: 'check-off-full' } } };
    expect(computeCrmPosting(order, row)).toEqual({ posting: 'posted_manual', crmPaymentId: null });
  });

  it('ни нашей, ни ручной оплаты на эту сумму → not_posted', () => {
    const order = { payments: { 1: { id: 7, type: 'invoicejur', amount: 999.99, status: 'check-off-full' } } };
    expect(computeCrmPosting(order, row)).toEqual({ posting: 'not_posted', crmPaymentId: null });
  });

  it('чужой банк-синк-платёж (другой externalId) не считается ручной проводкой → not_posted', () => {
    const order = { payments: { 1: { id: 8, type: 'invoicejur', amount: 167885.42, status: 'check-off-full', externalId: 'tochka-OTHER' } } };
    expect(computeCrmPosting(order, row)).toEqual({ posting: 'not_posted', crmPaymentId: null });
  });

  it('оплата не в статусе поступления не считается проводкой → not_posted', () => {
    const order = { payments: { 1: { id: 9, type: 'invoicejur', amount: 167885.42, status: 'not-paid' } } };
    expect(computeCrmPosting(order, row)).toEqual({ posting: 'not_posted', crmPaymentId: null });
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

describe('normalizeStatementTransaction (выписка)', () => {
  const account = '40702810320000187916/044525104';

  it('нормализует входящую (Credit) транзакцию выписки', () => {
    const txn = {
      transactionId: 'cbs-tb;1369085641;1',
      paymentId: 'payment-2026-07-10_3272017395',
      creditDebitIndicator: 'Credit',
      status: 'Booked',
      documentNumber: '3685',
      documentProcessDate: '2026-07-10',
      description: 'ОПЛАТА ПО СЧЕТУ №53433',
      Amount: { amount: 484898.3, currency: 'RUB' },
      DebtorParty: { inn: '4632175267', name: 'ООО "АГРОПРОМСЕРВИС"', kpp: '463201001' },
      DebtorAccount: { identification: '40702810718250001163' },
    };
    const n = normalizeStatementTransaction(txn, account);
    expect(n).not.toBeNull();
    expect(n!.externalPaymentId).toBe('payment-2026-07-10_3272017395');
    expect(n!.amountKopecks).toBe(48489830);
    expect(n!.payerInn).toBe('4632175267');
    expect(n!.payerName).toContain('АГРОПРОМСЕРВИС');
    expect(n!.purpose).toContain('53433');
    expect(n!.signatureVerified).toBe(true);
  });

  it('исходящую (Debit) транзакцию игнорирует', () => {
    const txn = {
      paymentId: '1',
      creditDebitIndicator: 'Debit',
      Amount: { amount: 100, currency: 'RUB' },
    };
    expect(normalizeStatementTransaction(txn, account)).toBeNull();
  });
});

describe('detectForeignProject (маркетплейс по плательщику)', () => {
  it('Ozon по названию плательщика — столярка, хотя назначение обезличено', () => {
    expect(
      detectForeignProject({
        purpose: 'Оплата за тов. по дог. ИР-2367069/25 от 28.11.2025 согл.сч.№№:44966523 от 05.08.26.',
        payerName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ИНТЕРНЕТ РЕШЕНИЯ"',
        payerInn: '7704217370',
        recipientInn: '6321277326',
      }),
    ).toBe('stolyarka');
  });

  it('обычный клиент ЗМК с тем же назначением остаётся в разборе', () => {
    expect(
      detectForeignProject({
        purpose: 'Оплата за тов. согл.сч.№ 44966523',
        payerName: 'ООО "РОМАШКА"',
        payerInn: '1234567890',
        recipientInn: '6324017492',
      }),
    ).toBeNull();
  });
});
