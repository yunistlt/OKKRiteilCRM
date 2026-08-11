import { supabase } from '@/utils/supabase';
import { NormalizedPointPayment, kopecksToRubles, isBankSyncExternalId } from './types';
import { matchPaymentToOrder, classifyNonCustomerPayment } from './matching';
import { notifyPaymentTelegram } from './notify';
import { classifyProject } from './projects';
import { moveOrderToProductionAfterPayment } from './production';
import {
  createRetailCrmOrderPayment,
  deleteRetailCrmPayment,
  toRetailCrmPaidAt,
} from '@/lib/retailcrm/payments';
import { fetchRetailCrmOrder } from '@/lib/retailcrm/orders';

// Единственный источник правды по оплатам — банковский синк (выписка). Дубль оплаты
// (напр. вручную «оплаченный» счёт invoicejur на ту же сумму, что и наш банковский платёж)
// УДАЛЯЕМ — статус не меняем. Удаляем только НЕ наши (без externalId tochka-/tbank-)
// оплаченные записи, сумма которых совпадает с суммой банковского платежа (страховка).
const RECEIVED_STATUSES = new Set(['paid', 'check-off-full', 'payment-start']);

function isBankSyncPayment(p: any): boolean {
  return isBankSyncExternalId(p?.externalId);
}

async function reconcileOrderPaymentsToBank(order: any, newBankAmountRub: number): Promise<number> {
  const pays = Object.values(order?.payments || {}) as any[];
  // Суммы, которые считаются «поступившими по банку»: существующие банковские + новый платёж.
  const bankAmounts = new Set<number>([newBankAmountRub]);
  for (const p of pays) {
    if (isBankSyncPayment(p) && RECEIVED_STATUSES.has(p?.status)) bankAmounts.add(Number(p.amount));
  }
  let deleted = 0;
  for (const p of pays) {
    if (p?.id && RECEIVED_STATUSES.has(p?.status) && !isBankSyncPayment(p) && bankAmounts.has(Number(p.amount))) {
      const res = await deleteRetailCrmPayment(Number(p.id)).catch(() => ({ success: false }));
      if (res.success) deleted++;
    }
  }
  return deleted;
}

// Статус нашего платежа — всегда 'paid' (Оплачен полностью). Банковское поступление —
// это ПОЛНОСТЬЮ полученные деньги по своей строке платежа, а не «частичная оплата» заказа
// (частичность заказа RetailCRM выводит сам из суммы завершённых платежей vs суммы заказа).
// ВАЖНО: статус 'check-off-full' («Частичная оплата») в RetailCRM имеет paymentComplete=false,
// т.е. считается НЕОПЛАЧЕННЫМ. RetailCRM запрещает держать >1 неоплаченного платежа на заказе
// («leave only one unpaid cash payment») и на этом отклоняет ЛЮБОЙ orders/edit — в т.ч. перевод
// в производство: если рядом висит неоплаченный счёт менеджера, наша «частичная» оплата даёт
// второй неоплаченный платёж и блокирует смену статуса. Помечая приход как 'paid', оставляем
// неоплаченным максимум счёт менеджера (один) — правило проходит, заказ переводится.

export type CrmPosting = 'posted_auto' | 'posted_manual' | 'not_posted';

// ЧЕСТНОЕ состояние ПРОВОДКИ платежа на заказе RetailCRM (отдельно от неизменного факта прихода).
// Только читает заказ, ничего не мутирует. Логика:
//   • наш externalId есть на заказе                       → posted_auto (проведено нами);
//   • нашего нет, но есть НЕ наша оплата на ту же сумму    → posted_manual (провёл менеджер вручную);
//   • ни нашей, ни ручной оплаты на эту сумму нет          → not_posted.
export function computeCrmPosting(
  order: any,
  row: PointPaymentRow,
): { posting: CrmPosting; crmPaymentId: string | null } {
  const pays = Object.values(order?.payments || {}) as any[];
  const ourExt = `${row.source}-${row.external_payment_id}`;
  const ours = pays.find((p) => p?.externalId === ourExt);
  if (ours) {
    return { posting: 'posted_auto', crmPaymentId: ours.id != null ? String(ours.id) : row.retailcrm_payment_id ?? null };
  }
  const amountRub = kopecksToRubles(Number(row.amount_kopecks));
  const manual = pays.find(
    (p) => !isBankSyncPayment(p) && RECEIVED_STATUSES.has(p?.status) && Math.abs(Number(p?.amount) - amountRub) <= 0.5,
  );
  if (manual) return { posting: 'posted_manual', crmPaymentId: null };
  return { posting: 'not_posted', crmPaymentId: null };
}

// Сервис распределения платежей: приём (идемпотентно) → матчинг → проброс в RetailCRM.

const SELECT_COLUMNS =
  'id, source, external_payment_id, webhook_type, customer_code, signature_verified, ' +
  'amount_kopecks, currency, payment_date, payment_datetime, purpose, document_number, ' +
  'payer_name, payer_inn, payer_kpp, payer_account, payer_bank_bic, payer_bank_name, account_id, ' +
  'recipient_name, recipient_inn, ' +
  'status, match_method, match_confidence, extracted_invoice_number, extracted_invoice_numbers, ' +
  'match_candidates, matched_order_number, matched_order_id, retailcrm_payment_id, ' +
  'retailcrm_synced_at, retailcrm_error, crm_posting, posting_checked_at, ' +
  'raw_payload, notified_at, created_at, updated_at';

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
  retailcrm_synced_at: string | null;
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

async function pushMatchedPaymentToCrm(
  row: PointPaymentRow,
): Promise<{ movedToProduction: boolean; productionStatusName?: string; productionNotMovedReason?: string }> {
  const amountRub = kopecksToRubles(Number(row.amount_kopecks));

  // Тянем заказ один раз: для сверки дублей оплат и для гарда производства (статус/site).
  const order = row.matched_order_id ? await fetchRetailCrmOrder(row.matched_order_id) : null;

  const result = await createRetailCrmOrderPayment({
    orderId: row.matched_order_id,
    orderNumber: row.matched_order_number,
    amountRub,
    paidAt: toRetailCrmPaidAt(row.payment_datetime || row.payment_date),
    externalId: `${row.source}-${row.external_payment_id}`,
    comment: row.purpose || undefined,
    // Приход = полностью полученные деньги → 'paid' (см. пояснение выше про правило RetailCRM).
    status: 'paid',
  });

  if (result.success) {
    await supabase
      .from('point_payments')
      .update({
        retailcrm_payment_id: result.paymentId ?? null,
        retailcrm_synced_at: new Date().toISOString(),
        retailcrm_error: null,
        // Проводку провели мы, только что — фиксируем честное состояние (сверка потом подтвердит/поправит).
        crm_posting: 'posted_auto',
        posting_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    // Банк — источник правды: удаляем чужие (не из синка) оплаченные дубли на заказе,
    // чтобы не задваивать деньги (напр. вручную «оплаченный» счёт). Не критично.
    if (order) await reconcileOrderPaymentsToBank(order, amountRub).catch(() => 0);

    // После оплаты — перевести заказ в «Передано в производство» (не откатывая назад).
    // Не критично: сбой не должен ломать проброс оплаты (функция не бросает).
    const mv = await moveOrderToProductionAfterPayment(row.matched_order_id, {
      currentStatus: order?.status ?? null,
      site: order?.site ?? null,
    });
    return {
      movedToProduction: mv.moved,
      productionStatusName: mv.statusName,
      productionNotMovedReason: mv.notMovedReason,
    };
  } else {
    await supabase
      .from('point_payments')
      .update({
        retailcrm_error: result.error ?? 'unknown RetailCRM error',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    throw new Error(`RetailCRM payment create failed: ${result.error}`);
  }
}

/**
 * Обработка одного платежа: матчинг и (при уверенном совпадении + проверенной
 * подписи) проброс в RetailCRM. Неоднозначные/непроверенные — в очередь на разбор.
 */
export async function processPointPayment(row: PointPaymentRow): Promise<{ status: string }> {
  // Уже привязан, но не проброшен в CRM — повторяем только проброс.
  if ((row.status === 'matched' || row.status === 'manual') && row.matched_order_id && !row.retailcrm_synced_at) {
    // Уже привязан (авто или вручную), но не проброшен — повторяем только проброс, не пере-матч.
    await pushMatchedPaymentToCrm(row);
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
            ? 'внутренний перевод (плательщик = получатель)'
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

  let push: { movedToProduction: boolean; productionStatusName?: string; productionNotMovedReason?: string } = {
    movedToProduction: false,
  };
  if (autoMatch && updated) {
    push = await pushMatchedPaymentToCrm(updated as PointPaymentRow);
  }

  // Уведомление об оплате в Telegram — один раз на платёж:
  //   • ЗМКТЛ — только по разнесённым (matched); неразобранные не шлём;
  //   • столярка/консалтинг (чужой проект) — всегда, независимо от матча, в свой чат.
  const u = updated as PointPaymentRow;
  if (!row.notified_at && updated && (u.status === 'matched' || project === 'stolyarka' || project === 'consulting')) {
    await notifyPaymentTelegram(u, {
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
 * Ручная привязка платежа к заказу оператором.
 * Пробрасывает платёж в RetailCRM независимо от статуса подписи (человек подтвердил).
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
      retailcrm_synced_at: null,
      retailcrm_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;

  await pushMatchedPaymentToCrm(row as PointPaymentRow);
  return { status: 'manual' };
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

/** Строки, требующие обработки воркером: новые + привязанные, но не проброшенные. */
export async function claimProcessablePayments(limit = 10): Promise<PointPaymentRow[]> {
  // Новые (ещё не обработанные) + привязанные, но не проброшенные в CRM (нужен ретрай).
  const { data, error } = await supabase
    .from('point_payments')
    .select(SELECT_COLUMNS)
    .or(
      'and(status.eq.pending_match,processed_at.is.null),' +
        'and(status.eq.matched,retailcrm_synced_at.is.null),' +
        'and(status.eq.manual,retailcrm_synced_at.is.null)',
    )
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []) as PointPaymentRow[];
}

/**
 * Сверка ПРОВОДКИ с RetailCRM — чтобы БД не врала, когда проводку в CRM изменили/удалили/внесли
 * вручную. READ-ONLY по отношению к CRM и к ФАКТУ прихода: обновляет только crm_posting /
 * retailcrm_payment_id / posting_checked_at, НЕ пере-пушит и НЕ трогает поля прихода
 * (source/amount/purpose/payer/raw_payload). Берём сматченные на заказ платежи, давно не
 * проверявшиеся (posting_checked_at NULL/старые), небольшим батчем — со временем сверяются все.
 */
export async function reconcileCrmPostings(limit = 10): Promise<number> {
  const { data, error } = await supabase
    .from('point_payments')
    .select(SELECT_COLUMNS)
    .not('matched_order_id', 'is', null)
    .order('posting_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  const rows = (data || []) as PointPaymentRow[];

  let reconciled = 0;
  for (const row of rows) {
    if (row.matched_order_id == null) continue; // страховка (фильтр уже отсёк null)
    try {
      const order = await fetchRetailCrmOrder(row.matched_order_id);
      const { posting, crmPaymentId } = computeCrmPosting(order, row);
      const patch: Record<string, any> = {
        crm_posting: posting,
        // Не держим протухший id, если нашего платежа на заказе больше нет (приход при этом неизменен).
        retailcrm_payment_id: posting === 'posted_auto' ? crmPaymentId ?? row.retailcrm_payment_id ?? null : null,
        posting_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await supabase.from('point_payments').update(patch).eq('id', row.id);
      reconciled++;
    } catch {
      // Сверка не критична: отмечаем попытку, чтобы не залипать на одной строке.
      await supabase
        .from('point_payments')
        .update({ posting_checked_at: new Date().toISOString() })
        .eq('id', row.id);
    }
  }
  return reconciled;
}
