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
 *  - "Аванс по сч. 52721 от 06.07.2026 за мебель ..."         → 52721
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

  // «счёт/счету/счета/счете № 12345», сокращение «сч. 12345» и «12345/2».
  // Сокращённая форма требует точку («сч.»), чтобы не путать с «р/сч 40802…» (номер расчётного счёта).
  const invoiceRe = /сч(?:[её]т[а-я]*|\.)\s*№?\s*([0-9]+(?:[/-][0-9]+)?)/gi;
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

/**
 * ИНН контрагента заказа. RetailCRM кладёт его в несколько мест — берём первое непустое:
 *   order.contragent.INN            — реквизиты плательщика на самом заказе (основное);
 *   order.company.contragent.INN    — реквизиты компании корпоративного клиента;
 *   order.customer.contragent.INN   — реквизиты контрагента клиента.
 */
function orderPayerInn(rawPayload: any): string | null {
  const places = [
    rawPayload?.contragent,
    rawPayload?.company?.contragent,
    rawPayload?.customer?.contragent,
    rawPayload?.customer?.mainCompany?.contragent,
  ];
  for (const c of places) {
    const inn = normalizeInn(c?.INN || c?.inn || null);
    if (inn) return inn;
  }
  return normalizeInn(rawPayload?.customer?.INN || null);
}

/** Статусы, в которых заказ деньги уже не ждёт — такие кандидаты по ИНН не рассматриваем. */
const CLOSED_ORDER_STATUSES = (process.env.PAYMENTS_CLOSED_ORDER_STATUSES || 'cancel,complete,otgruzen')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Заказы контрагента по ИНН плательщика — БЕЗ привязки к сумме (в отличие от старого
 * фолбэка, который искал только точное совпадение суммы и потому не видел предоплаты).
 * Отбор идёт по индексу (raw_payload->'contragent'->>'INN'), см. миграцию 20260801.
 */
async function findOrdersByInn(inn: string | null): Promise<any[]> {
  if (!inn) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('order_id, number, status, totalsumm, created_at, raw_payload')
    .eq('raw_payload->contragent->>INN', inn)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).filter((o: any) => !CLOSED_ORDER_STATUSES.includes(String(o.status)));
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
 *  3. Похожий номер (обрезанная/перепутанная цифра) — привязываем ТОЛЬКО при двух
 *     независимых подтверждающих сигналах (ИНН / сумма / доля предоплаты / дата счёта /
 *     название клиента). Один сигнал → кандидат на подтверждение человеком.
 *  4. Иначе — в очередь на разбор.
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

  const matched = (order: any, method: 'order_number' | 'order_number_fuzzy' | 'inn_signals' | 'inn_amount_date', confidence: 'high' | 'medium' | 'low') => ({
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

  // 2. По ИНН плательщика — заказы этого контрагента, ждущие денег. Сумма больше не
  //    обязана совпадать точно (предоплата 70% раньше проваливала весь фолбэк):
  //    решают подтверждающие сигналы, их нужно два.
  const byInn = await findOrdersByInn(normalizeInn(payment.payerInn));
  if (byInn.length) {
    const picked = pickBySignals(byInn, payment, 'ИНН контрагента');
    if (picked.order) return matched(picked.order, 'inn_signals', picked.confidence);
    if (picked.hints.length) return { ...base, candidates: picked.hints };
  }

  // 2a. Старый фолбэк — ИНН плательщика + точная сумма заказа (на случай, если ИНН лежит
  //     не в order.contragent, а в другом месте payload и поиск по индексу его не нашёл).
  const fallback = await matchByInnAmountDate(payment);
  if (fallback.length === 1) return matched(fallback[0], 'inn_amount_date', 'medium');
  if (fallback.length > 1) {
    return { ...base, candidates: fallback.map((r) => toCandidate(r, 'inn_amount_date')) };
  }

  // 3. Номер с опечаткой (обрезанная/перепутанная цифра). Сам по себе похожий номер —
  //    НЕ основание для привязки: нужно ДВА независимых подтверждающих сигнала.
  const fuzzy = await findOrdersByFuzzyNumber(invoiceNumbers);
  if (fuzzy.length) {
    const picked = pickBySignals(fuzzy, payment, 'похожий номер');
    if (picked.order) return matched(picked.order, 'order_number_fuzzy', picked.confidence);
    if (picked.hints.length) return { ...base, candidates: picked.hints };
  }

  // 4. Ничего не нашли — в очередь на разбор.
  return base;
}

/**
 * Заказы с ПОХОЖИМ номером: обрезанная цифра («5333» → 53338) или одна перепутанная
 * («53348» → 53338). Одним запросом через OR-набор LIKE-шаблонов, чтобы не бить базу
 * по разу на вариант. Только для номеров из 4+ цифр — иначе шаблон ловит пол-базы.
 */
async function findOrdersByFuzzyNumber(invoiceNumbers: string[]): Promise<any[]> {
  for (const raw of invoiceNumbers) {
    const num = String(raw).replace(/\D/g, '');
    if (num.length < 4) continue;
    const patterns = new Set<string>();
    patterns.add(`${num}_`); // потеряна последняя цифра: 5333 → 53338
    patterns.add(`_${num}`); // потеряна первая цифра
    for (let i = 0; i < num.length; i++) {
      patterns.add(`${num.slice(0, i)}_${num.slice(i + 1)}`); // одна цифра перепутана
    }
    const or = Array.from(patterns).map((p) => `number.like.${p}`).join(',');
    const { data, error } = await supabase
      .from('orders')
      .select('order_id, number, status, totalsumm, created_at, raw_payload')
      .or(or)
      .neq('number', num)
      .limit(20);
    if (error) throw error;
    if (data && data.length) return data;
  }
  return [];
}

// Типовые доли предоплаты (%) — «70 пред / 30 перед отгрузкой» и подобные схемы.
// Настраивается через env, чтобы не править код под новую схему расчётов.
const PREPAY_SHARES = (process.env.PAYMENTS_PREPAY_SHARES || '30,50,70,100')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/**
 * Выбор заказа из кандидатов по подтверждающим сигналам. Привязываем ТОЛЬКО когда ровно
 * один кандидат набрал два независимых сигнала — иначе отдаём подсказки человеку.
 * `anchor` — как кандидаты вообще нашлись (для человекочитаемой причины в сообщении).
 */
function pickBySignals(
  orders: any[],
  payment: NormalizedPointPayment,
  anchor: string,
): { order: any | null; confidence: 'high' | 'medium'; hints: OrderMatchCandidate[] } {
  const scored = orders
    .map((o) => ({ order: o, signals: confirmingSignals(o, payment) }))
    .sort((a, b) => b.signals.length - a.signals.length);
  const confirmed = scored.filter((s) => s.signals.length >= 2);
  if (confirmed.length === 1) {
    const only = confirmed[0];
    return {
      order: only.order,
      confidence: only.signals.includes('ИНН плательщика') ? 'high' : 'medium',
      hints: [toCandidate(only.order, `${anchor} · ${only.signals.join(', ')}`)],
    };
  }
  const hints = scored
    .filter((s) => s.signals.length > 0)
    .slice(0, 5)
    .map((s) => toCandidate(s.order, `${anchor} · ${s.signals.join(', ')}`));
  return { order: null, confidence: 'medium', hints };
}

/**
 * Независимые подтверждающие сигналы «этот платёж про этот заказ».
 * Возвращает человекочитаемые названия сработавших — они же идут в сообщение оператору.
 */
export function confirmingSignals(order: any, payment: NormalizedPointPayment): string[] {
  const signals: string[] = [];

  // Номер счёта из назначения ТОЧНО равен номеру заказа. Похожий номер сигналом не считается:
  // он и так «якорь» ветки нечёткого поиска, а под шаблон 5333_ подходит весь десяток 53330…53339 —
  // засчитав его как подтверждение, мы бы привязывали платёж к соседнему заказу того же клиента.
  const num = String(order.number ?? '').replace(/\D/g, '');
  if (num && extractInvoiceNumbers(payment.purpose).some((v) => String(v).replace(/\D/g, '') === num)) {
    signals.push('номер счёта');
  }
  const amountRub = payment.amountKopecks / 100;
  const total = Number(order.totalsumm) || 0;

  const orderInn = orderPayerInn(order.raw_payload);
  const payerInn = normalizeInn(payment.payerInn);
  if (orderInn && payerInn && orderInn === payerInn) signals.push('ИНН плательщика');

  if (total > 0 && Math.abs(amountRub - total) <= 0.5) {
    signals.push('сумма заказа');
  } else if (total > 0 && amountRub < total) {
    const sharePct = (amountRub / total) * 100;
    const hit = PREPAY_SHARES.find((s) => Math.abs(sharePct - s) <= 0.5);
    if (hit) signals.push(`${hit}% суммы заказа`);
  }

  // Дата счёта из назначения («от 13.07.2026») рядом с датой создания заказа.
  const invoiceDate = extractInvoiceDate(payment.purpose);
  const created = order.created_at ? new Date(order.created_at) : null;
  if (invoiceDate && created) {
    const days = Math.abs(invoiceDate.getTime() - created.getTime()) / 86400000;
    if (days <= 3) signals.push('дата счёта');
  }

  // Имя плательщика ≈ имя клиента в заказе (по нормализованной подстроке).
  const client = String(
    order.raw_payload?.customer?.nickName ||
      [order.raw_payload?.customer?.firstName, order.raw_payload?.customer?.lastName].filter(Boolean).join(' ') ||
      '',
  );
  if (payment.payerName && client && namesLookAlike(payment.payerName, client)) signals.push('название клиента');

  return signals;
}

/** «Оплата по счету № 5333 от 13.07.2026» → Date(2026-07-13). */
function extractInvoiceDate(purpose?: string | null): Date | null {
  if (!purpose) return null;
  const m = /от\s+(\d{2})[.\-/](\d{2})[.\-/](\d{4})/.exec(String(purpose));
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Грубое сравнение названий: без ООО/кавычек/регистра, вхождение значимой части. */
function namesLookAlike(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/(ооо|оао|зао|ип|пао|общество с ограниченной ответственностью)/g, '').replace(/[^a-zа-яё0-9]/gi, '');
  const na = norm(a);
  const nb = norm(b);
  if (na.length < 4 || nb.length < 4) return false;
  return na.includes(nb) || nb.includes(na);
}
