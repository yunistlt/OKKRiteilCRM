import { supabase } from '@/utils/supabase';
import { NormalizedPointPayment, kopecksToRubles } from './types';
import { matchPaymentToOrder, classifyNonCustomerPayment } from './matching';
import { notifyPaymentTelegram, notifyPendingPaymentsTelegram, notifyPaymentPushErrorTelegram } from './notify';
import { classifyProject, type ProjectKey } from './projects';
import { registerPushFailure, clearPushFailure, explainPushError } from './push-retry';
import { moveOrderToProductionAfterPayment } from './production';
import { addOwnPayment } from '@/lib/own-crm/payments';

/**
 * Оплата из банка разносится в заказ ОКК — в RetailCRM ничего не уходит
 * (решение владельца 15.10.2026: своя CRM единственная система учёта, RetailCRM
 * архив на чтение). Раньше платёж проводился методом `orders/payments/create`,
 * и на этом пути заказ мог вовсе не доехать: ошибка магазина заказа, правило
 * «один неоплаченный платёж», удалённые вручную дубли.
 *
 * Теперь путь один на все заказы, и свои, и приехавшие из RetailCRM: строка в
 * `order_payments` со `source = 'okk'` (см. lib/own-crm/payments.ts).
 */

// Сервис распределения платежей: приём (идемпотентно) → матчинг → разнос в заказ ОКК.

const SELECT_COLUMNS =
  'id, source, external_payment_id, webhook_type, customer_code, signature_verified, ' +
  'amount_kopecks, currency, payment_date, payment_datetime, purpose, document_number, ' +
  'payer_name, payer_inn, payer_kpp, payer_account, payer_bank_bic, payer_bank_name, account_id, ' +
  'recipient_name, recipient_inn, ' +
  'status, match_method, match_confidence, extracted_invoice_number, extracted_invoice_numbers, ' +
  'match_candidates, matched_order_number, matched_order_id, ' +
  'posted_at, posting_error, ' +
  'raw_payload, notified_at, pending_notified_at, renotify_requested_at, created_at, updated_at';

export interface PointPaymentRow {
  id: number;
  source: string;
  external_payment_id: string;
  signature_verified: boolean;
  amount_kopecks: number;
  currency: string;
  payment_date: string | null;
  payment_datetime: string | null;
  purpose: string | null;
  payer_name: string | null;
  payer_inn: string | null;
  status: string;
  matched_order_id: number | null;
  matched_order_number: string | null;
  /** Когда оплата разнесена в заказ ОКК. NULL — ещё не разнесена. */
  posted_at: string | null;
  [key: string]: any;
}

function normalizedFromRow(row: PointPaymentRow): NormalizedPointPayment {
  return {
    source: row.source,
    externalPaymentId: row.external_payment_id,
    webhookType: row.webhook_type ?? null,
    customerCode: row.customer_code ?? null,
    amountKopecks: Number(row.amount_kopecks),
    currency: row.currency,
    paymentDate: row.payment_date ?? null,
    paymentDatetime: row.payment_datetime ?? null,
    purpose: row.purpose ?? null,
    documentNumber: row.document_number ?? null,
    payerName: row.payer_name ?? null,
    payerInn: row.payer_inn ?? null,
    payerKpp: row.payer_kpp ?? null,
    payerAccount: row.payer_account ?? null,
    payerBankBic: row.payer_bank_bic ?? null,
    payerBankName: row.payer_bank_name ?? null,
    accountId: row.account_id ?? null,
    recipientName: row.recipient_name ?? null,
    recipientInn: row.recipient_inn ?? null,
    signatureVerified: Boolean(row.signature_verified),
    rawPayload: row.raw_payload ?? {},
  };
}

/**
 * Приём платежа: идемпотентная запись по (source, external_payment_id).
 * Возвращает строку (существующую или созданную) и признак новизны.
 */
export async function ingestPointPayment(
  p: NormalizedPointPayment,
): Promise<{ row: PointPaymentRow; isNew: boolean }> {
  const insertRow = {
    source: p.source,
    external_payment_id: p.externalPaymentId,
    webhook_type: p.webhookType ?? null,
    customer_code: p.customerCode ?? null,
    signature_verified: p.signatureVerified,
    amount_kopecks: p.amountKopecks,
    currency: p.currency,
    payment_date: p.paymentDate ?? null,
    payment_datetime: p.paymentDatetime ?? null,
    purpose: p.purpose ?? null,
    document_number: p.documentNumber ?? null,
    payer_name: p.payerName ?? null,
    payer_inn: p.payerInn ?? null,
    payer_kpp: p.payerKpp ?? null,
    payer_account: p.payerAccount ?? null,
    payer_bank_bic: p.payerBankBic ?? null,
    payer_bank_name: p.payerBankName ?? null,
    account_id: p.accountId ?? null,
    recipient_name: p.recipientName ?? null,
    recipient_inn: p.recipientInn ?? null,
    raw_payload: p.rawPayload ?? {},
    status: 'pending_match',
  };

  const { data: inserted, error } = await supabase
    .from('point_payments')
    .upsert(insertRow, { onConflict: 'source,external_payment_id', ignoreDuplicates: true })
    .select(SELECT_COLUMNS);

  if (error) throw error;

  if (inserted && inserted.length > 0) {
    return { row: inserted[0] as PointPaymentRow, isNew: true };
  }

  // Конфликт — платёж уже был. Возвращаем существующую строку.
  const { data: existing, error: selErr } = await supabase
    .from('point_payments')
    .select(SELECT_COLUMNS)
    .eq('source', p.source)
    .eq('external_payment_id', p.externalPaymentId)
    .single();
  if (selErr) throw selErr;
  return { row: existing as PointPaymentRow, isNew: false };
}

/** Итог разноса оплаты в заказ: проведена ли и уехал ли заказ в производство. */
export interface PostPaymentResult {
  posted: boolean;
  movedToProduction: boolean;
  productionStatusName?: string;
  productionNotMovedReason?: string;
}

/**
 * Разнести оплату в заказ ОКК и перевести заказ в производство.
 *
 * Путь один на все заказы — и на свои, и на приехавшие когда-то из RetailCRM:
 * заказ уже лежит у нас, значит и оплата пишется к нам, в `order_payments`.
 * Наружу, в RetailCRM, не уходит ничего.
 *
 * Бросает, если разнести не удалось: платёж остаётся без `posted_at`, и крон
 * берёт его на следующем прогоне — деньги не теряются.
 */
async function postPaymentToOrder(row: PointPaymentRow): Promise<PostPaymentResult> {
  const amountRub = kopecksToRubles(Number(row.amount_kopecks));

  // Заказ ищем по id из матчинга: оплату вносим в карточку, которая у нас есть.
  const { data: order } = row.matched_order_id
    ? await supabase
        .from('orders')
        .select('id, number')
        .eq('order_id', row.matched_order_id)
        .maybeSingle()
    : { data: null };

  if (!order) {
    await registerPostingFailure(row, 'заказ не найден в базе ОКК');
    throw new Error(`Оплата не разнесена: заказ ${row.matched_order_number ?? row.matched_order_id} не найден в базе ОКК`);
  }

  try {
    await addOwnPayment({
      orderId: Number((order as any).id),
      orderNumber: String((order as any).number ?? row.matched_order_number ?? ''),
      amount: amountRub,
      paidAt: String(row.payment_date || (row.payment_datetime || '').slice(0, 10)),
      method: 'Банковский перевод',
      payerName: row.payer_name ?? null,
      purpose: row.purpose ?? null,
      pointPaymentId: Number(row.id),
      createdBy: 'разнос оплат',
    });
  } catch (e: any) {
    await registerPostingFailure(row, String(e?.message || e));
    throw e;
  }

  await supabase
    .from('point_payments')
    .update({
      posted_at: new Date().toISOString(),
      posting_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  await clearPushFailure(row.id).catch(() => undefined);

  /**
   * Оплата пришла — заказ уходит в производство. Статус пишется в нашей базе
   * через `editOrder` (одна дверь), оттуда же его забирает ЦехУспех.
   * Не критично: сбой перевода не отменяет факт разнесённой оплаты.
   */
  const moved = await moveOrderToProductionAfterPayment(row.matched_order_id);
  return {
    posted: true,
    movedToProduction: moved.moved,
    productionStatusName: moved.statusName,
    productionNotMovedReason: moved.notMovedReason,
  };
}

/**
 * Записать неудачу разноса и позвать человека — но не на каждую попытку.
 *
 * Крон пробует снова каждые несколько минут, и при длительной поломке человек
 * получал поток одинаковых сообщений (инцидент 30.09.2026).
 */
async function registerPostingFailure(row: PointPaymentRow, reason: string): Promise<void> {
  await supabase
    .from('point_payments')
    .update({ posting_error: reason, updated_at: new Date().toISOString() })
    .eq('id', row.id);

  const failure = await registerPushFailure(row.id, reason).catch(() => ({
    attempts: 1,
    shouldNotify: true,
    explanation: explainPushError(reason, 1),
  }));

  if (failure.shouldNotify) {
    await notifyPaymentPushErrorTelegram(row, reason, failure.explanation).catch((e) =>
      console.error('[payments] posting error notify failed:', e?.message || e),
    );
  }
}

/**
 * Обработка одного платежа: матчинг и (при уверенном совпадении + проверенной
 * подписи) разнос в заказ ОКК. Неоднозначные/непроверенные — в очередь на разбор.
 */
export async function processPointPayment(row: PointPaymentRow): Promise<{ status: string }> {
  // Уже привязан, но не проброшен в CRM — повторяем только проброс.
  if ((row.status === 'matched' || row.status === 'manual') && row.matched_order_id && !row.posted_at) {
    // Уже привязан (авто или вручную), но не разнесён — повторяем только разнос, не пере-матч.
    await postPaymentToOrder(row);
    return { status: row.status };
  }

  const normalized = normalizedFromRow(row);

  // 0. Не-клиентский кредит (перевод между своими счетами / банковская операция) —
  // не матчим и не тащим в разбор, помечаем «Пропущено».
  const nonCustomer = classifyNonCustomerPayment(normalized);
  if (nonCustomer) {
    await supabase
      .from('point_payments')
      .update({
        status: 'ignored',
        review_note:
          nonCustomer === 'internal'
            ? 'внутренний перевод (плательщик — своё юрлицо)'
            : 'банковская операция (депозит/проценты/возврат банка)',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return { status: 'ignored' };
  }

  const match = await matchPaymentToOrder(normalized);

  // Авто-привязка при уверенном матче. High (номер+плательщик/сумма) достаточно надёжен,
  // чтобы привязать даже без проверенной подписи вебхука; medium — только при подписи.
  const autoMatch =
    match.status === 'matched' && (normalized.signatureVerified || match.confidence === 'high');

  // Проект: совпал заказ RetailCRM → ЗМКТЛ; иначе по назначению/получателю (столярка/консалтинг).
  const signals = {
    purpose: normalized.purpose,
    recipientInn: normalized.recipientInn,
    payerName: normalized.payerName,
    payerInn: normalized.payerInn,
  };
  const project = classifyProject(signals, match.status === 'matched');

  const update: Record<string, any> = {
    match_method: match.method,
    match_confidence: match.confidence,
    extracted_invoice_number: match.extractedInvoiceNumber,
    extracted_invoice_numbers: match.extractedInvoiceNumbers,
    match_candidates: match.candidates,
    project,
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (autoMatch) {
    update.status = 'matched';
    update.matched_order_id = match.matchedOrderId;
    update.matched_order_number = match.matchedOrderNumber;
  } else if (project === 'stolyarka' || project === 'consulting') {
    // Чужой проект опознан (в RetailCRM ЗМКТЛ не ведётся) — действие не требуется.
    update.status = 'recognized';
  } else {
    // ЗМКТЛ/не определён без матча — на ручной разбор.
    update.status = 'pending_match';
  }

  const { data: updated, error } = await supabase
    .from('point_payments')
    .update(update)
    .eq('id', row.id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;

  let push: PostPaymentResult = { posted: false, movedToProduction: false };
  if (autoMatch && updated) {
    push = await postPaymentToOrder(updated as PointPaymentRow);
  }

  // Уведомление об оплате в Telegram — один раз на платёж:
  //   • ЗМКТЛ — только по разнесённым (matched); неразобранные не шлём;
  //   • столярка/консалтинг (чужой проект) — всегда, независимо от матча, в свой чат.
  const u = updated as PointPaymentRow;
  if (!row.notified_at && updated && (u.status === 'matched' || project === 'stolyarka' || project === 'consulting')) {
    await notifyPaymentTelegram(u, {
      // Признак разноса берём из результата, а не из снимка `updated`: снимок
      // сделан ДО разноса и всегда показывал «ещё не разнесена».
      posted: push.posted,
      movedToProduction: push.movedToProduction,
      productionStatusName: push.productionStatusName,
      productionNotMovedReason: push.productionNotMovedReason,
    }).catch((e) => console.error('[payments] telegram notify failed:', e?.message || e));
    await supabase
      .from('point_payments')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', row.id);
  }

  return { status: (updated as PointPaymentRow).status };
}

/**
 * Человеческое имя текущего статуса заказа. Имена статусов — из справочника
 * RetailCRM, не выдумываем свои.
 */
async function orderStatusName(orderNumber: string | null): Promise<string | null> {
  if (!orderNumber) return null;
  const { data: order } = await supabase
    .from('orders')
    .select('status')
    .eq('number', String(orderNumber))
    .limit(1)
    .maybeSingle();
  const code = (order as any)?.status;
  if (!code) return null;
  const { data: st } = await supabase
    .from('statuses')
    .select('name')
    .eq('code', String(code))
    .maybeSingle();
  return ((st as any)?.name as string) || null;
}

/**
 * Досылка уведомлений по просьбе человека.
 *
 * Бывает, что сообщение ушло не туда (маршрут был неверным) или не ушло вовсе —
 * например, после ручной привязки платежа к заказу. Отправляет бот сам, на
 * следующем прогоне: человек только помечает платежи, а не шлёт руками.
 *
 * Метка снимается независимо от исхода отправки: повторять бесконечно нельзя,
 * иначе чат зальёт одним и тем же платежом.
 */
export async function resendRequestedNotifications(limit = 20): Promise<number> {
  const { data, error } = await supabase
    .from('point_payments')
    .select(SELECT_COLUMNS)
    .not('renotify_requested_at', 'is', null)
    .order('renotify_requested_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as PointPaymentRow[];
  let sent = 0;
  for (const row of rows) {
    let chatId: string | null = null;
    try {
      // Перевод в производство делали не сейчас, поэтому говорим, где заказ стоит
      // сегодня: без этой строки досланное сообщение выглядит обрезанным.
      const res = await notifyPaymentTelegram(row, {
        currentStatusName: await orderStatusName(row.matched_order_number),
      });
      chatId = res?.chatId ?? null;
      if (chatId) sent += 1;
      else console.warn('[payments] resend skipped:', row.id, res?.skipped ?? 'unknown');
    } catch (e: any) {
      console.error('[payments] resend notify failed:', row.id, e?.message || e);
    }
    // Отметку «уведомлено» ставим только по факту отправки: иначе ненастроенный
    // адрес выглядел бы в базе как доставленное сообщение, и тишину в чате было
    // бы нечем объяснить.
    await supabase
      .from('point_payments')
      .update({
        renotify_requested_at: null,
        ...(chatId ? { notified_at: new Date().toISOString(), telegram_chat_id: chatId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  }
  return sent;
}

/**
 * Ручная привязка платежа к заказу оператором.
 * Разносит платёж в заказ независимо от статуса подписи (человек подтвердил).
 */
export async function assignPointPaymentToOrder(params: {
  paymentId: number;
  orderId?: number | null;
  orderNumber: string;
  reviewedBy: string;
  note?: string | null;
}): Promise<{ status: string }> {
  const { data: row, error } = await supabase
    .from('point_payments')
    .update({
      status: 'manual',
      matched_order_id: params.orderId ?? null,
      matched_order_number: params.orderNumber,
      match_method: 'manual',
      match_confidence: 'high',
      reviewed_by: params.reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: params.note ?? null,
      posted_at: null,
      posting_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;

  await postPaymentToOrder(row as PointPaymentRow);
  return { status: 'manual' };
}

/**
 * Напоминание в Telegram о неразобранных поступлениях (status='pending_match').
 *
 * Зачем: уведомление об оплате уходит только по РАЗНЕСЁННЫМ платежам, поэтому деньги,
 * которые не удалось привязать к заказу, лежали в очереди молча (инцидент 01.08.2026:
 * приход 331 834,58 ₽ от 22.07 висел десять дней, заказ 53338 не ушёл в производство).
 *
 * Шлём ОДНИМ дайджестом на все висящие платежи, а не письмом на каждый: очередь читают
 * как список дел. Повторяем не чаще, чем раз в PAYMENTS_PENDING_REMIND_HOURS (по умолч. 24 ч),
 * иначе крон каждые 15 минут превратит напоминание в спам. Возвращает число строк в дайджесте.
 */
export async function notifyPendingForReview(): Promise<number> {
  const remindHours = Number(process.env.PAYMENTS_PENDING_REMIND_HOURS || 24);
  const cutoff = new Date(Date.now() - remindHours * 3600_000).toISOString();

  const { data, error } = await supabase
    .from('point_payments')
    .select(SELECT_COLUMNS)
    .eq('status', 'pending_match')
    .order('amount_kopecks', { ascending: false })
    .limit(50);
  if (error) throw error;
  const pending = (data || []) as PointPaymentRow[];
  if (!pending.length) return 0;

  // Напоминаем, только если есть хоть один «созревший» — новый или давно не напоминавшийся.
  const due = pending.filter((r) => !r.pending_notified_at || String(r.pending_notified_at) < cutoff);
  if (!due.length) return 0;

  await notifyPendingPaymentsTelegram(pending, {
    totalCount: pending.length,
    totalKopecks: pending.reduce((s, r) => s + Number(r.amount_kopecks || 0), 0),
  });

  // Отметку ставим всем висящим — тогда очередь напоминает о себе целиком раз в сутки,
  // а не капает отдельным сообщением на каждый новый платёж.
  await supabase
    .from('point_payments')
    .update({ pending_notified_at: new Date().toISOString() })
    .in('id', pending.map((r) => r.id));

  return pending.length;
}

/** Пометить платёж как намеренно пропущенный (не наш / возврат). */
export async function ignorePointPayment(params: {
  paymentId: number;
  reviewedBy: string;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('point_payments')
    .update({
      status: 'ignored',
      reviewed_by: params.reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: params.note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId);
  if (error) throw error;
}

/** Строки, требующие обработки воркером: новые + привязанные, но не разнесённые. */
export async function claimProcessablePayments(limit = 10): Promise<PointPaymentRow[]> {
  // Новые (ещё не обработанные) + привязанные, но не разнесённые в заказ (нужен ретрай).
  const { data, error } = await supabase
    .from('point_payments')
    .select(SELECT_COLUMNS)
    .or(
      'and(status.eq.pending_match,processed_at.is.null),' +
        'and(status.eq.matched,posted_at.is.null),' +
        'and(status.eq.manual,posted_at.is.null)',
    )
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []) as PointPaymentRow[];
}

/**
 * Ручной выбор проекта платежа (решение владельца 14.10.2026).
 * Автоопределение по назначению/ИНН ошибается на обезличенных назначениях («Оплата по счету № …»),
 * и такой платёж висит в разборе. Человек ставит проект сам:
 *   • столярка/консалтинг — в RetailCRM не ведутся, разбор не нужен → «Опознан»;
 *   • ЗМКТЛ — остаётся на разборе, его ещё надо привязать к заказу.
 * Авто-классификатор поверх не проедет: он работает один раз, до processed_at.
 */
export async function setPointPaymentProject(params: {
  paymentId: number;
  project: ProjectKey;
  reviewedBy: string;
}): Promise<void> {
  // Привязанный к заказу платёж проект не меняет: он уже разнесён в заказ.
  const { data: row } = await supabase
    .from('point_payments')
    .select('matched_order_id')
    .eq('id', params.paymentId)
    .maybeSingle();
  if (row?.matched_order_id) {
    throw new Error('Платёж уже привязан к заказу — проект сменить нельзя');
  }
  const { error } = await supabase
    .from('point_payments')
    .update({
      project: params.project,
      status: params.project === 'zmktl' ? 'pending_match' : 'recognized',
      reviewed_by: params.reviewedBy,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId);
  if (error) throw error;
}
