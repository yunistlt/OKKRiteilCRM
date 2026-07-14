// Общие типы сервиса распределения платежей «с точки».

export type PointPaymentStatus =
  | 'pending_match' // ждёт матчинга или ручного разбора
  | 'matched'       // привязан к заказу
  | 'manual'        // привязан вручную оператором
  | 'ignored'       // намеренно пропущен (не наш платёж / возврат)
  | 'failed';       // ошибка обработки

export type PointPaymentMatchMethod = 'order_number' | 'inn_amount_date' | 'manual';

export type PointPaymentMatchConfidence = 'high' | 'medium' | 'low';

/**
 * Нормализованный платёж — источник-независимая форма.
 * Адаптер конкретного банка/шлюза приводит свой payload к этому виду.
 */
export interface NormalizedPointPayment {
  source: string;                 // 'tochka'
  externalPaymentId: string;      // уникальный id платежа у источника (идемпотентность)
  webhookType?: string | null;
  customerCode?: string | null;
  amountKopecks: number;          // сумма в копейках
  currency: string;               // 'RUB'
  paymentDate?: string | null;    // YYYY-MM-DD
  paymentDatetime?: string | null; // ISO
  purpose?: string | null;        // назначение платежа
  documentNumber?: string | null; // номер платёжного документа
  payerName?: string | null;
  payerInn?: string | null;
  payerKpp?: string | null;
  payerAccount?: string | null;
  payerBankBic?: string | null;
  payerBankName?: string | null;
  accountId?: string | null;      // счёт получателя (наш)
  recipientName?: string | null;  // наименование юрлица-получателя (наше)
  recipientInn?: string | null;   // ИНН получателя
  signatureVerified: boolean;     // проверена ли подпись вебхука
  rawPayload: Record<string, unknown>;
}

/** Кандидат-заказ для ручного разбора / авто-привязки. */
export interface OrderMatchCandidate {
  orderId: number | null;   // orders.order_id (id в RetailCRM)
  orderNumber: string;      // orders.number
  totalKopecks: number | null;
  status: string | null;
  payerInn: string | null;  // ИНН контрагента заказа, если есть
  reason: string;           // почему кандидат (order_number | inn_amount_date)
}

export interface PointPaymentMatchResult {
  status: Extract<PointPaymentStatus, 'matched' | 'pending_match'>;
  method: PointPaymentMatchMethod | null;
  confidence: PointPaymentMatchConfidence | null;
  matchedOrderId: number | null;
  matchedOrderNumber: string | null;
  extractedInvoiceNumber: string | null;
  extractedInvoiceNumbers: string[];
  candidates: OrderMatchCandidate[];
}

export function rublesToKopecks(amount: number): number {
  return Math.round(amount * 100);
}

export function kopecksToRubles(kopecks: number): number {
  return Math.round(kopecks) / 100;
}

/**
 * Платёж на заказе создан нашим банк-синком (Точка/Т-Банк) — определяется по externalId
 * вида `tochka-…` / `tbank-…`. Это «фактический приход денег», в отличие от выставленного
 * менеджером счёта (invoicejur без externalId). Признак не зависит от кода типа оплаты,
 * поэтому переживает смену типа (bank-transfer → invoicejur) без изменения логики.
 */
export function isBankSyncExternalId(externalId: unknown): boolean {
  return (
    typeof externalId === 'string' &&
    (externalId.startsWith('tochka-') || externalId.startsWith('tbank-'))
  );
}

/**
 * Парсит сумму из строки/числа. Точка присылает рубли (напр. "484898.30" или 484898.3),
 * иногда в назначении встречается формат "484898-30" (дефис вместо разделителя копеек).
 */
export function parseAmountToKopecks(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return rublesToKopecks(input);
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // "484898.30" | "484 898,30" | "484898-30"
  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/(\d)-(\d{2})$/, '$1.$2') // хвост "-30" → ".30"
    .replace(',', '.');

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return rublesToKopecks(value);
}
