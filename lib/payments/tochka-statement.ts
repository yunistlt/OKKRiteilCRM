import { getTochkaWebhookConfig } from './tochka-admin';
import { NormalizedPointPayment, parseAmountToKopecks } from './types';

// Тяга банковской выписки Точки (Open Banking) для бэкофилла исторических платежей.
// Поток асинхронный: список счетов → создать выписку за период → дождаться → забрать транзакции.
// ВАЖНО: полная выписка может требовать OAuth — на personal JWT возможен ответ 501.
// В этом случае backfill вернёт понятную ошибку (нужен OAuth), приём вебхуков это не затрагивает.

const OB = 'open-banking/v1.0';

async function obFetch(method: string, path: string, body?: unknown) {
  const { base, token } = getTochkaWebhookConfig();
  const res = await fetch(`${base}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Точка требует User-Agent для open-banking.
      'User-Agent': 'OKKRiteilCRM/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* оставляем текст */
  }
  return { ok: res.ok, status: res.status, data };
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Список счетов (accountId вида "40702810.../044525104"). JWT-доступно. */
export async function getTochkaAccounts(): Promise<string[]> {
  const res = await obFetch('GET', 'accounts');
  if (!res.ok) throw new Error(`Точка accounts → ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
  const accounts = res.data?.Data?.Account || res.data?.Data?.accounts || [];
  return accounts
    .map((a: any) => str(a.accountId) || str(a.id))
    .filter(Boolean) as string[];
}

/** Создать выписку за период. Возвращает statementId. */
export async function createTochkaStatement(accountId: string, from: string, to: string): Promise<{ statementId: string | null; status: number; data: any }> {
  const res = await obFetch('POST', 'statements', {
    Data: { Statement: { accountId, startDateTime: from, endDateTime: to } },
  });
  const statementId =
    str(res.data?.Data?.Statement?.statementId) ||
    str(res.data?.Data?.statementId) ||
    null;
  return { statementId, status: res.status, data: res.data };
}

/** Получить выписку по statementId: статус и транзакции. */
export async function getTochkaStatement(accountId: string, statementId: string) {
  const res = await obFetch('GET', `accounts/${accountId}/statements/${statementId}`);
  const stmt = res.data?.Data?.Statement;
  const statement = Array.isArray(stmt) ? stmt[0] : stmt;
  return {
    ok: res.ok,
    status: res.status,
    stmtStatus: str(statement?.status),
    transactions: (statement?.Transaction || []) as any[],
    data: res.data,
  };
}

/**
 * Нормализует транзакцию выписки в платёж.
 * Берём только входящие (creditDebitIndicator = 'Credit'); плательщик — DebtorParty.
 */
export function normalizeStatementTransaction(txn: any, accountId: string): NormalizedPointPayment | null {
  const indicator = str(txn?.creditDebitIndicator);
  if (indicator && indicator.toLowerCase() !== 'credit') return null; // не входящий

  const externalPaymentId = str(txn?.paymentId) || str(txn?.transactionId);
  if (!externalPaymentId) return null;

  const amountKopecks = parseAmountToKopecks(txn?.Amount?.amount ?? txn?.amount);
  if (amountKopecks === null) return null;

  const debtor = txn?.DebtorParty || {};
  const debtorAccount = txn?.DebtorAccount || {};
  const paymentDate = str(txn?.documentProcessDate) || str(txn?.date);

  return {
    source: 'tochka',
    externalPaymentId,
    webhookType: 'statement',
    customerCode: null,
    amountKopecks,
    currency: str(txn?.Amount?.currency) || 'RUB',
    paymentDate,
    paymentDatetime: paymentDate ? new Date(`${paymentDate}T00:00:00Z`).toISOString() : null,
    purpose: str(txn?.description) || str(txn?.paymentPurpose),
    documentNumber: str(txn?.documentNumber),
    payerName: str(debtor?.name),
    payerInn: str(debtor?.inn),
    payerKpp: str(debtor?.kpp),
    payerAccount: str(debtorAccount?.identification),
    payerBankBic: null,
    payerBankName: null,
    accountId,
    // Выписка получена нами по авторизованному API → доверенный источник (авто-матч разрешён).
    signatureVerified: true,
    rawPayload: txn,
  };
}
