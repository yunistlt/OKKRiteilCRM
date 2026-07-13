import { getCrmConfig } from './leads';

// Создание платежа на заказе в RetailCRM v5.
// Метод: POST /api/v5/orders/payments/create (form-encoded, apiKey в query).
// Тип платежа берётся из RETAILCRM_BANK_PAYMENT_TYPE (код из справочника payment-types),
// по умолчанию 'bank-transfer'. externalId делает операцию идемпотентной на стороне CRM.

export interface CreateRetailCrmPaymentInput {
  orderId?: number | null;   // id заказа в RetailCRM (orders.order_id) — предпочтительно
  orderNumber?: string | null;
  amountRub: number;         // сумма в рублях
  paidAt?: string | null;    // 'YYYY-MM-DD HH:mm:ss'
  externalId: string;        // ключ идемпотентности (напр. tochka-<paymentId>)
  comment?: string | null;
  type?: string | null;      // код типа оплаты; иначе из env
  status?: string | null;    // статус платежа: 'paid' (полн.) | 'check-off-full' (частичн.)
}

export interface CreateRetailCrmPaymentResult {
  success: boolean;
  paymentId?: string | null;
  error?: string | null;
}

function getBankPaymentType(explicit?: string | null): string {
  return explicit || process.env.RETAILCRM_BANK_PAYMENT_TYPE || 'bank-transfer';
}

export async function createRetailCrmOrderPayment(
  input: CreateRetailCrmPaymentInput,
): Promise<CreateRetailCrmPaymentResult> {
  const { url: baseUrl, key: apiKey, site } = await getCrmConfig();

  const order: Record<string, any> = {};
  if (input.orderId) order.id = input.orderId;
  else if (input.orderNumber) order.number = input.orderNumber;
  else return { success: false, error: 'Не задан заказ (orderId/orderNumber)' };

  const payment: Record<string, any> = {
    externalId: input.externalId,
    amount: input.amountRub,
    type: getBankPaymentType(input.type),
    status: input.status || 'paid',
    order,
  };
  if (input.paidAt) payment.paidAt = input.paidAt;
  if (input.comment) payment.comment = input.comment;

  const requestUrl = `${baseUrl}/api/v5/orders/payments/create?apiKey=${apiKey}`;
  const body = new URLSearchParams();
  body.append('payment', JSON.stringify(payment));
  if (site) body.append('site', site);

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const result = await response.json().catch(() => ({ success: false, errorMsg: 'invalid json' }));

  if (!result.success) {
    const error = result.errors
      ? JSON.stringify(result.errors)
      : result.errorMsg || `HTTP ${response.status}`;
    return { success: false, error };
  }

  return { success: true, paymentId: result.id != null ? String(result.id) : null };
}

/** Редактирование существующего платежа заказа (напр. сброс статуса в 'not-paid'). */
export async function editRetailCrmPayment(
  paymentId: number,
  fields: { status?: string },
): Promise<{ success: boolean; error?: string }> {
  const { url: baseUrl, key: apiKey, site } = await getCrmConfig();
  const body = new URLSearchParams();
  body.append('by', 'id');
  body.append('payment', JSON.stringify(fields));
  if (site) body.append('site', site);

  const response = await fetch(`${baseUrl}/api/v5/orders/payments/${paymentId}/edit?apiKey=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const result = await response.json().catch(() => ({ success: false, errorMsg: 'invalid json' }));
  if (!result.success) {
    return { success: false, error: result.errors ? JSON.stringify(result.errors) : result.errorMsg || `HTTP ${response.status}` };
  }
  return { success: true };
}

/** Формат paidAt для RetailCRM из ISO/даты. */
export function toRetailCrmPaidAt(date?: string | null): string | null {
  if (!date) return null;
  const d = new Date(date.length <= 10 ? `${date}T12:00:00Z` : date);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
