import { supabase } from '@/utils/supabase';
import {
  NormalizedPointPayment,
  OrderMatchCandidate,
  PointPaymentMatchResult,
} from './types';

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
 * Основной матч — по номеру заказа (orders.number), извлечённому из назначения.
 * Берём первого кандидата, для которого нашёлся ровно один заказ.
 */
async function matchByOrderNumber(
  invoiceNumbers: string[],
): Promise<{ order: any } | { ambiguous: any[] } | null> {
  for (const num of invoiceNumbers) {
    const { data, error } = await supabase
      .from('orders')
      .select('order_id, number, status, totalsumm, raw_payload')
      .eq('number', num)
      .limit(5);
    if (error) throw error;
    if (!data || data.length === 0) continue;
    if (data.length === 1) return { order: data[0] };
    return { ambiguous: data };
  }
  return null;
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
 * Полный матчинг платежа на заказ.
 * high-confidence (order_number, единственный заказ) → status 'matched'.
 * Всё остальное → 'pending_match' с кандидатами для ручного разбора.
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

  // 1. Основной матч — по номеру заказа.
  const byNumber = await matchByOrderNumber(invoiceNumbers);
  if (byNumber && 'order' in byNumber) {
    const order = byNumber.order;
    return {
      ...base,
      status: 'matched',
      method: 'order_number',
      confidence: 'high',
      matchedOrderId: order.order_id ?? null,
      matchedOrderNumber: String(order.number ?? ''),
      candidates: [toCandidate(order, 'order_number')],
    };
  }
  if (byNumber && 'ambiguous' in byNumber) {
    return {
      ...base,
      candidates: byNumber.ambiguous.map((r) => toCandidate(r, 'order_number')),
    };
  }

  // 2. Фолбэк — ИНН + сумма + дата.
  const fallback = await matchByInnAmountDate(payment);
  if (fallback.length === 1) {
    const order = fallback[0];
    return {
      ...base,
      status: 'matched',
      method: 'inn_amount_date',
      confidence: 'medium',
      matchedOrderId: order.order_id ?? null,
      matchedOrderNumber: String(order.number ?? ''),
      candidates: [toCandidate(order, 'inn_amount_date')],
    };
  }
  if (fallback.length > 1) {
    return {
      ...base,
      candidates: fallback.map((r) => toCandidate(r, 'inn_amount_date')),
    };
  }

  // 3. Ничего не нашли — в очередь на разбор.
  return base;
}
