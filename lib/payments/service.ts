import { supabase } from '@/utils/supabase';
import { NormalizedPointPayment, kopecksToRubles } from './types';
import { matchPaymentToOrder } from './matching';
import { notifyPaymentTelegram } from './notify';
import {
  createRetailCrmOrderPayment,
  toRetailCrmPaidAt,
} from '@/lib/retailcrm/payments';

// Сервис распределения платежей: приём (идемпотентно) → матчинг → проброс в RetailCRM.

const SELECT_COLUMNS =
  'id, source, external_payment_id, webhook_type, customer_code, signature_verified, ' +
  'amount_kopecks, currency, payment_date, payment_datetime, purpose, document_number, ' +
  'payer_name, payer_inn, payer_kpp, payer_account, payer_bank_bic, payer_bank_name, account_id, ' +
  'recipient_name, recipient_inn, ' +
  'status, match_method, match_confidence, extracted_invoice_number, extracted_invoice_numbers, ' +
  'match_candidates, matched_order_number, matched_order_id, retailcrm_payment_id, ' +
  'retailcrm_synced_at, retailcrm_error, raw_payload, notified_at, created_at, updated_at';

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

async function pushMatchedPaymentToCrm(row: PointPaymentRow): Promise<void> {
  const result = await createRetailCrmOrderPayment({
    orderId: row.matched_order_id,
    orderNumber: row.matched_order_number,
    amountRub: kopecksToRubles(Number(row.amount_kopecks)),
    paidAt: toRetailCrmPaidAt(row.payment_datetime || row.payment_date),
    externalId: `${row.source}-${row.external_payment_id}`,
    comment: row.purpose || undefined,
  });

  if (result.success) {
    await supabase
      .from('point_payments')
      .update({
        retailcrm_payment_id: result.paymentId ?? null,
        retailcrm_synced_at: new Date().toISOString(),
        retailcrm_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
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
  if (row.status === 'matched' && row.matched_order_id && !row.retailcrm_synced_at) {
    await pushMatchedPaymentToCrm(row);
    return { status: 'matched' };
  }

  const normalized = normalizedFromRow(row);
  const match = await matchPaymentToOrder(normalized);

  // Авто-привязка разрешена только при проверенной подписи вебхука.
  const autoMatch = match.status === 'matched' && normalized.signatureVerified;

  const update: Record<string, any> = {
    match_method: match.method,
    match_confidence: match.confidence,
    extracted_invoice_number: match.extractedInvoiceNumber,
    extracted_invoice_numbers: match.extractedInvoiceNumbers,
    match_candidates: match.candidates,
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (autoMatch) {
    update.status = 'matched';
    update.matched_order_id = match.matchedOrderId;
    update.matched_order_number = match.matchedOrderNumber;
  } else {
    // Не подтверждено (нет подписи) или неоднозначно — на ручной разбор.
    update.status = 'pending_match';
  }

  const { data: updated, error } = await supabase
    .from('point_payments')
    .update(update)
    .eq('id', row.id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;

  if (autoMatch && updated) {
    await pushMatchedPaymentToCrm(updated as PointPaymentRow);
  }

  // Уведомление об оплате в Telegram — один раз на платёж (сбой не ломает разнос).
  if (!row.notified_at && updated) {
    await notifyPaymentTelegram(updated as PointPaymentRow).catch((e) =>
      console.error('[payments] telegram notify failed:', e?.message || e),
    );
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
    .or('and(status.eq.pending_match,processed_at.is.null),and(status.eq.matched,retailcrm_synced_at.is.null)')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []) as PointPaymentRow[];
}
