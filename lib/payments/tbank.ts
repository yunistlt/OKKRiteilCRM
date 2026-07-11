import { NormalizedPointPayment, parseAmountToKopecks } from './types';

// Адаптер Т-Банк Бизнес (T-API) для сервиса распределения платежей.
// Канал — банковская выписка по расчётным счетам (poll по крону).
//   Счета:   GET  {base}/v4/bank-accounts
//   Выписка: GET  {base}/v1/statement?accountNumber=&from=&to=  (курсорная пагинация)
// Авторизация — Bearer-токен из окружения (TBANK_API_TOKEN). IP-whitelist не требуется.
// Док: https://developer.tbank.ru/docs/api/scheta-i-vipiski
//
// Формат объекта операции у Т-Банка сверяется на живом ответе (см. /api/payments/tbank/probe):
// нормализация ниже — защитная, с фолбэками по именам полей. Направление операции читаем
// строго: если это не однозначно ВХОДЯЩИЙ платёж — пропускаем (fail-safe, деньги не разносим).

const SOURCE = 'tbank';

export interface TbankConfig {
  token: string;
  base: string;
}

/** Конфиг из окружения. null — токен не задан (сервис деградирует, крон no-op). */
export function getTbankConfig(): TbankConfig | null {
  const token = process.env.TBANK_API_TOKEN;
  if (!token) return null;
  const base = (process.env.TBANK_API_BASE || 'https://business.tbank.ru/openapi/api').replace(/\/+$/, '');
  return { token, base };
}

export function isTbankConfigured(): boolean {
  return Boolean(process.env.TBANK_API_TOKEN);
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function tbankFetch(cfg: TbankConfig, path: string): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${cfg.base}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* оставляем как текст */
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Расчётные счета организации (20-значные accountNumber).
 * Ответ v4 разбираем защитно: массив / {accounts} / {bankAccounts} / {data}.
 */
export async function getTbankAccounts(cfg: TbankConfig): Promise<string[]> {
  const res = await tbankFetch(cfg, '/v4/bank-accounts');
  if (!res.ok) {
    throw new Error(`Т-Банк bank-accounts → ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  const list: any[] = Array.isArray(res.data)
    ? res.data
    : res.data?.accounts || res.data?.bankAccounts || res.data?.data || [];
  const numbers = list
    .map((a) => str(a?.accountNumber) || str(a?.number) || str(a?.account))
    .filter((n): n is string => Boolean(n) && /^\d{20}$/.test(n));
  // Уникализируем на случай дублей между разделами ответа.
  return Array.from(new Set(numbers));
}

/**
 * Все операции выписки за период по одному счёту (проходим курсор до конца).
 * operationStatus=Transaction — только проведённые (без авторизаций/холдов).
 */
export async function getTbankOperations(
  cfg: TbankConfig,
  accountNumber: string,
  from: string,
  to?: string,
): Promise<any[]> {
  const operations: any[] = [];
  let cursor: string | null = null;
  // Защита от бесконечного цикла на нестандартном ответе.
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({
      accountNumber,
      from,
      limit: '1000',
      operationStatus: 'Transaction',
    });
    if (to) params.set('to', to);
    if (cursor) params.set('cursor', cursor);

    const res = await tbankFetch(cfg, `/v1/statement?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Т-Банк statement ${accountNumber} → ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
    }
    const batch: any[] = Array.isArray(res.data)
      ? res.data
      : res.data?.operations || res.data?.operation || res.data?.data || [];
    operations.push(...batch);

    cursor = str(res.data?.nextCursor);
    if (!cursor || batch.length === 0) break;
  }
  return operations;
}

// Значения, однозначно означающие ВХОДЯЩИЙ платёж (кредит по нашему счёту).
const INCOMING = new Set(['credit', 'income', 'incoming', 'c', 'cr']);
const OUTGOING = new Set(['debit', 'outcome', 'outgoing', 'expense', 'd', 'dr']);

/** Направление операции: 'in' | 'out' | null (не определено). */
function operationDirection(op: any): 'in' | 'out' | null {
  const raw =
    str(op?.typeOfOperation) ||
    str(op?.operationType) ||
    str(op?.type) ||
    str(op?.creditDebitIndicator) ||
    str(op?.direction);
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (INCOMING.has(v)) return 'in';
  if (OUTGOING.has(v)) return 'out';
  return null;
}

function normalizeCurrency(op: any): string {
  const c = str(op?.currency) || str(op?.Amount?.currency);
  if (!c) return 'RUB';
  if (c === '643' || c.toUpperCase() === 'RUB' || c.toUpperCase() === 'RUR') return 'RUB';
  return c.toUpperCase();
}

/**
 * Операция выписки Т-Банка → нормализованный платёж (source='tbank').
 * Возвращает null, если операция не является однозначно входящей или нет ключевых данных
 * (fail-safe: сомнительное не попадает в разнос).
 */
export function normalizeTbankOperation(op: any, accountNumber: string): NormalizedPointPayment | null {
  // Только однозначно входящие. Неопределённое направление — пропускаем.
  if (operationDirection(op) !== 'in') return null;

  const externalPaymentId =
    str(op?.operationId) || str(op?.id) || str(op?.transactionId) || str(op?.ucid);
  if (!externalPaymentId) return null;

  const amountKopecks = parseAmountToKopecks(
    op?.amount ?? op?.accountAmount ?? op?.operationAmount ?? op?.Amount?.amount ?? op?.rubaAmount,
  );
  if (amountKopecks === null || amountKopecks <= 0) return null;

  const cp = op?.counterParty || op?.counterparty || op?.payer || {};

  const purpose = str(op?.payPurpose) || str(op?.purpose) || str(op?.description) || str(op?.paymentPurpose);
  const dateIso = str(op?.operationDate) || str(op?.chargeDate) || str(op?.drawDate) || str(op?.date);
  const paymentDate = dateIso ? dateIso.slice(0, 10) : null;

  return {
    source: SOURCE,
    externalPaymentId,
    webhookType: null,
    customerCode: null,
    amountKopecks,
    currency: normalizeCurrency(op),
    paymentDate,
    paymentDatetime: dateIso,
    purpose,
    documentNumber: str(op?.documentNumber) || str(op?.docNumber),
    payerName: str(op?.payerName) || str(cp?.name),
    payerInn: str(op?.payerInn) || str(cp?.inn),
    payerKpp: str(op?.payerKpp) || str(cp?.kpp),
    payerAccount: str(op?.payerAccount) || str(cp?.account),
    payerBankBic: str(op?.payerBic) || str(op?.payerBankBic) || str(cp?.bankBic) || str(cp?.bic),
    payerBankName: str(op?.payerBankName) || str(cp?.bankName),
    accountId: accountNumber,
    // Выписка получена по авторизованному API → доверенный источник (как у Точки),
    // авто-матч разрешён.
    signatureVerified: true,
    rawPayload: op,
  };
}
