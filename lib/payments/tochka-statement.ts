import { getTochkaWebhookConfig } from './tochka-admin';
import { NormalizedPointPayment, parseAmountToKopecks } from './types';
import { supabase } from '@/utils/supabase';

// Тяга банковской выписки Точки (Open Banking) для бэкофилла исторических платежей.
// Поток асинхронный: список счетов → создать выписку за период → дождаться → забрать транзакции.
// ВАЖНО: полная выписка может требовать OAuth — на personal JWT возможен ответ 501.
// В этом случае backfill вернёт понятную ошибку (нужен OAuth), приём вебхуков это не затрагивает.

const OB = 'open-banking/v1.0';

async function obFetch(method: string, path: string, body?: unknown) {
  const { base, token } = getTochkaWebhookConfig();
  const res = await fetch(`${base}/${OB}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Точка требует User-Agent для open-banking.
      'User-Agent': 'OKKRiteilCRM/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Декодируем ПРИНУДИТЕЛЬНО как UTF-8: на /accounts и /customers Точка отдаёт
  // charset=windows-1251, хотя тело — UTF-8; res.text() иначе выдаёт кракозябры.
  const text = new TextDecoder('utf-8').decode(await res.arrayBuffer());
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

/** Сырой ответ /accounts (для диагностики: есть ли имя владельца/customerCode). */
export async function getTochkaAccountsRaw(): Promise<{ ok: boolean; status: number; data: any }> {
  return obFetch('GET', 'accounts');
}

/** Сырой ответ по клиенту /customers/{customerCode} (юрлицо-владелец счёта). */
export async function getTochkaCustomerRaw(customerCode: string): Promise<{ ok: boolean; status: number; data: any }> {
  return obFetch('GET', `customers/${encodeURIComponent(customerCode)}`);
}

/** База 20-значного счёта из accountId вида "40702810.../044525104". */
export function accountBase(accountId: string | null | undefined): string | null {
  if (!accountId) return null;
  const m = String(accountId).match(/\d{20}/);
  return m ? m[0] : null;
}

/**
 * Карта «счёт → юрлицо-получатель» для Точки: у платежей нет имени получателя в
 * payload (в Open Banking владелец = сам запрошенный счёт), поэтому тянем из /accounts
 * (+ /customers по customerCode). Ключ — база 20-значного счёта.
 * Разбор защитный по именам полей; сверяется probe-роутом на живом ответе.
 */
export async function getTochkaRecipientMap(): Promise<Map<string, { name: string | null; inn: string | null }>> {
  const map = new Map<string, { name: string | null; inn: string | null }>();
  const res = await obFetch('GET', 'accounts');
  if (!res.ok) return map;
  const accounts: any[] = res.data?.Data?.Account || res.data?.Data?.accounts || [];

  // Кэш клиентов, чтобы не дёргать одного customerCode многократно.
  const customerCache = new Map<string, { name: string | null; inn: string | null }>();

  for (const a of accounts) {
    const base = accountBase(str(a?.accountId) || str(a?.id));
    if (!base) continue;

    // Имя может лежать прямо в аккаунте.
    let name =
      str(a?.legalName) || str(a?.companyName) || str(a?.name) || str(a?.Nickname) || str(a?.shortName) || null;
    let inn = str(a?.inn) || str(a?.taxCode) || null;

    // Иначе — по клиенту.
    const cc = str(a?.customerCode) || str(a?.CustomerCode);
    if ((!name || !inn) && cc) {
      let cust = customerCache.get(cc);
      if (!cust) {
        const cr = await getTochkaCustomerRaw(cc);
        const c = cr.ok ? cr.data?.Data?.Customer || cr.data?.Data || cr.data : null;
        cust = {
          name:
            str(c?.legalName) || str(c?.shortName) || str(c?.fullName) || str(c?.companyName) || str(c?.name) || null,
          inn: str(c?.inn) || str(c?.taxCode) || null,
        };
        customerCache.set(cc, cust);
      }
      name = name || cust.name;
      inn = inn || cust.inn;
    }

    map.set(base, { name, inn });
  }
  return map;
}

// Кэш карты счетов в пределах тёплого инстанса (наши счета меняются редко).
let _recipMapCache: { map: Map<string, { name: string | null; inn: string | null }>; at: number } | null = null;

export async function getTochkaRecipientMapCached(
  ttlMs = 3_600_000,
): Promise<Map<string, { name: string | null; inn: string | null }>> {
  if (_recipMapCache && Date.now() - _recipMapCache.at < ttlMs) return _recipMapCache.map;
  const map = await getTochkaRecipientMap();
  if (map.size > 0) _recipMapCache = { map, at: Date.now() };
  return map;
}

/**
 * Проставляет получателя (наше юрлицо) нормализованному платежу Точки по его счёту.
 * No-op при ошибке/отсутствии — приём платежа не ломаем.
 */
export async function enrichTochkaRecipient(p: NormalizedPointPayment): Promise<void> {
  if (p.recipientName) return;
  const base = accountBase(p.accountId);
  if (!base) return;
  try {
    const map = await getTochkaRecipientMapCached();
    const rec = map.get(base);
    if (rec?.name) {
      p.recipientName = rec.name;
      p.recipientInn = rec.inn ?? null;
      return;
    }
    console.warn(`[Tochka] получатель по счёту ${base} не найден в карте счетов — фолбэк по истории`);
  } catch (err) {
    console.warn(
      `[Tochka] карта счетов недоступна (${(err as Error).message}) — фолбэк по истории платежей`,
    );
  }
  // Фолбэк: тот же счёт уже приходил с известным получателем. Без него платёж теряет
  // проект (инцидент 2026-08-25: оплата ЦехУспех уехала в «Требуют разбора»).
  await enrichRecipientFromHistory(p);
}

/** Получатель по нашему счёту из ранее сохранённых платежей (когда API Точки не ответил). */
async function enrichRecipientFromHistory(p: NormalizedPointPayment): Promise<void> {
  if (!p.accountId) return;
  try {
    const { data } = await supabase
      .from('point_payments')
      .select('recipient_name, recipient_inn')
      .eq('account_id', p.accountId)
      .not('recipient_inn', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((data as any)?.recipient_inn) {
      p.recipientName = (data as any).recipient_name ?? null;
      p.recipientInn = (data as any).recipient_inn;
    }
  } catch {
    /* получатель необязателен — приём платежа не ломаем */
  }
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
