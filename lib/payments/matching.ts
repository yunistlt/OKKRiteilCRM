import { supabase } from '@/utils/supabase';
import {
  NormalizedPointPayment,
  OrderMatchCandidate,
  PointPaymentMatchResult,
} from './types';
import { isInternalGroupTransfer } from './projects';

/**
 * Извлекает номера счетов/договоров из назначения платежа.
 *
 * Реальные примеры (банк Точка, юрлица):
 *  - "ОПЛАТА ПО СЧЕТУ №53433 ОТ 08.06.2026Г ..."           → 53433
 *  - "Окончательная по счету № 53016 ..., к дог. № 53016"    → 53016
 *  - "Оплата по счету № 1007/2 от 10 июля 2026 г. ..."       → 1007/2, 1007
 *
 * Номер счёта в этой точке = номер заказа в RetailCRM (orders.number).
 * Возвращаем кандидатов в порядке приоритета, без дублей.
 */
export function extractInvoiceNumbers(purpose?: string | null): string[] {
  if (!purpose) return [];
  const text = String(purpose);
  const candidates: string[] = [];

  const push = (value?: string | null) => {
    const v = (value || '').trim();
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  // «счёт/счету/счета/счете № 12345» и «12345/2»
  const invoiceRe = /сч[её]т[а-я]*\s*№?\s*([0-9]+(?:[/-][0-9]+)?)/gi;
  // «договор/дог. № 12345»
  const contractRe = /дог(?:овор[а-я]*)?\.?\s*(?:купли[- ]продажи\s*)?№?\s*([0-9]+(?:[/-][0-9]+)?)/gi;

  for (const re of [invoiceRe, contractRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const full = m[1];
      push(full);
      // База до разделителя: "1007/2" → "1007" (счёт может относиться к заказу 1007).
      const base = full.split(/[/-]/)[0];
      if (base && base !== full) push(base);
    }
  }

  return candidates;
}

/** Нормализация ИНН для сравнения (только цифры). */
function normalizeInn(inn?: string | null): string | null {
  if (!inn) return null;
  const digits = String(inn).replace(/\D/g, '');
  return digits.length ? digits : null;
}

/** ИНН контрагента заказа из raw_payload (разные возможные места). */
function orderPayerInn(rawPayload: any): string | null {
  const c = rawPayload?.contragent || rawPayload?.customer?.contragent || {};
  return normalizeInn(c?.INN || c?.inn || rawPayload?.customer?.INN || null);
}

function toCandidate(row: any, reason: string): OrderMatchCandidate {
  return {
    orderId: row.order_id ?? null,
    orderNumber: String(row.number ?? ''),
    totalKopecks:
      row.totalsumm != null ? Math.round(Number(row.totalsumm) * 100) : null,
    status: row.status ?? null,
    payerInn: orderPayerInn(row.raw_payload),
    reason,
  };
}

/**
 * Не-клиентский кредит, который НЕ надо матчить/разбирать:
 *  - 'internal' — перевод между своими счетами (плательщик = получатель, одно юрлицо);
 *  - 'bank'     — банковская операция (депозит/проценты/возврат средств банка).
 */
const BANK_PURPOSE_RE = /депозит|проц(?:ент|\.)|возврат средств по/i;

export function classifyNonCustomerPayment(
  payment: NormalizedPointPayment,
): 'internal' | 'bank' | null {
  // Внутренний перевод между своими юрлицами группы (оба ИНН — свои), напр. субаренда.
  if (isInternalGroupTransfer(payment.payerInn, payment.recipientInn)) return 'internal';
  if (BANK_PURPOSE_RE.test(payment.purpose || '')) return 'bank';
  return null;
}

/**
 * Сверка кандидата-заказа с платежом по сигналам плательщика и суммы (номер — якорь).
 *  - плательщик: ИНН плательщика = ИНН клиента заказа;
 *  - сумма: платёж ≤ сумме заказа (полная/частичная) и точное совпадение.
 * high  — совпал плательщик ИЛИ сумма ровно;
 * medium— сумма укладывается (частичная), плательщик не подтверждён;
 * low   — сумма больше заказа и плательщик не совпал (подозрительно).
 */
function scoreCandidate(
  order: any,
  payment: NormalizedPointPayment,
): { confidence: 'high' | 'medium' | 'low'; payerMatch: boolean } {
  const orderInn = orderPayerInn(order.raw_payload);
  const payerInn = normalizeInn(payment.payerInn);
  const payerMatch = Boolean(orderInn && payerInn && orderInn === payerInn);

  const total = Number(order.totalsumm) || 0;
  const amountRub = payment.amountKopecks / 100;
  const amountExact = total > 0 && Math.abs(amountRub - total) <= 0.5;
  const amountFits = total <= 0 || amountRub <= total + 0.5;

  let confidence: 'high' | 'medium' | 'low';
  if (payerMatch || amountExact) confidence = 'high';
  else if (amountFits) confidence = 'medium';
  else confidence = 'low';
  return { confidence, payerMatch };
}

/**
 * Основной матч — по номеру заказа (orders.number), извлечённому из назначения.
 * Берём первого кандидата, для которого нашёлся ровно один заказ.
 */
/** Заказы, найденные по извлечённым номерам счёта (первый номер, давший совпадения). */
async function findOrdersByNumber(invoiceNumbers: string[]): Promise<any[]> {
  for (const num of invoiceNumbers) {
    const { data, error } = await supabase
      .from('orders')
      .select('order_id, number, status, totalsumm, raw_payload')
      .eq('number', num)
      .limit(5);
    if (error) throw error;
    if (data && data.length > 0) return data;
  }
  return [];
}

/**
 * Фолбэк — ИНН плательщика + сумма + дата (телефона у юрлиц нет).
 * Считаем совпадением по сумме заказа (totalsumm) и ИНН контрагента.
 */
async function matchByInnAmountDate(
  payment: NormalizedPointPayment,
): Promise<any[]> {
  const inn = normalizeInn(payment.payerInn);
  if (!inn) return [];

  const amountRub = payment.amountKopecks / 100;
  // Небольшой допуск на округление.
  const low = amountRub - 0.5;
  const high = amountRub + 0.5;

  const { data, error } = await supabase
    .from('orders')
    .select('order_id, number, status, totalsumm, raw_payload')
    .gte('totalsumm', low)
    .lte('totalsumm', high)
    .limit(50);
  if (error) throw error;
  if (!data) return [];

  return data.filter((row: any) => orderPayerInn(row.raw_payload) === inn);
}

/**
 * Полный матчинг платежа на заказ по сигналам: НОМЕР счёта (якорь) + плательщик + сумма.
 *  1. По номеру находим заказ(ы). Один кандидат → сверяем плательщика/сумму (scoreCandidate):
 *     high (совпал плательщик или сумма ровно) / medium (сумма укладывается) / low.
 *     Несколько кандидатов → выбираем того, у кого совпал плательщик (иначе — в разбор).
 *  2. Фолбэк без номера — ИНН плательщика + сумма заказа → medium.
 *  3. Иначе — в очередь на разбор.
 */
export async function matchPaymentToOrder(
  payment: NormalizedPointPayment,
): Promise<PointPaymentMatchResult> {
  const invoiceNumbers = extractInvoiceNumbers(payment.purpose);

  const base: PointPaymentMatchResult = {
    status: 'pending_match',
    method: null,
    confidence: null,
    matchedOrderId: null,
    matchedOrderNumber: null,
    extractedInvoiceNumber: invoiceNumbers[0] ?? null,
    extractedInvoiceNumbers: invoiceNumbers,
    candidates: [],
  };

  const matched = (order: any, method: 'order_number' | 'inn_amount_date', confidence: 'high' | 'medium' | 'low') => ({
    ...base,
    status: 'matched' as const,
    method,
    confidence,
    matchedOrderId: order.order_id ?? null,
    matchedOrderNumber: String(order.number ?? ''),
    candidates: [toCandidate(order, method)],
  });

  // 1. По номеру счёта → заказ.
  const byNumber = await findOrdersByNumber(invoiceNumbers);
  if (byNumber.length === 1) {
    const { confidence } = scoreCandidate(byNumber[0], payment);
    if (confidence === 'low') {
      // Номер совпал, но сумма больше заказа и плательщик другой — на разбор.
      return { ...base, candidates: [toCandidate(byNumber[0], 'order_number')] };
    }
    return matched(byNumber[0], 'order_number', confidence);
  }
  if (byNumber.length > 1) {
    // Несколько заказов с таким номером — разрешаем по плательщику.
    const byPayer = byNumber.filter((o) => scoreCandidate(o, payment).payerMatch);
    if (byPayer.length === 1) return matched(byPayer[0], 'order_number', 'high');
    return { ...base, candidates: byNumber.map((r) => toCandidate(r, 'order_number')) };
  }

  // 2. Фолбэк — ИНН плательщика + сумма заказа.
  const fallback = await matchByInnAmountDate(payment);
  if (fallback.length === 1) return matched(fallback[0], 'inn_amount_date', 'medium');
  if (fallback.length > 1) {
    return { ...base, candidates: fallback.map((r) => toCandidate(r, 'inn_amount_date')) };
  }

  // 3. Ничего не нашли — в очередь на разбор.
  return base;
}
