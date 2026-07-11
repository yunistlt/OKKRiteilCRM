import { z } from 'zod';
import {
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  decodeJwt,
  type JWTPayload,
} from 'jose';
import {
  NormalizedPointPayment,
  parseAmountToKopecks,
} from './types';

// Точка присылает вебхук как JWT (application/jwt), подписанный RS256.
// Проверяем подпись публичным ключом Точки:
//   - TOCHKA_WEBHOOK_JWKS_URL  — URL JWKS (предпочтительно), либо
//   - TOCHKA_WEBHOOK_PUBLIC_KEY — публичный ключ в формате PEM (SPKI).
// Если ключ не сконфигурирован — подпись НЕ проверяется (signatureVerified=false),
// платёж всё равно принимается, но авто-проброс в RetailCRM для него запрещён
// (только ручной разбор). Это безопасная деградация: неподтверждённый платёж
// не должен автоматически создавать оплату в CRM.

const INCOMING_WEBHOOK_TYPES = new Set([
  'incomingPayment',
  'incomingSbpPayment',
  'incomingSbpB2BPayment',
]);

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  const url = process.env.TOCHKA_WEBHOOK_JWKS_URL;
  if (!url) return null;
  if (!cachedJwks) cachedJwks = createRemoteJWKSet(new URL(url));
  return cachedJwks;
}

export interface DecodedTochkaWebhook {
  payload: JWTPayload & Record<string, any>;
  signatureVerified: boolean;
}

/**
 * Проверяет и декодирует JWT вебхука Точки.
 * Возвращает payload и флаг, была ли реально проверена подпись.
 * Бросает ошибку только если подпись сконфигурирована и НЕ прошла проверку.
 */
export async function verifyAndDecodeTochkaWebhook(
  rawJwt: string,
): Promise<DecodedTochkaWebhook> {
  const token = rawJwt.trim();
  if (!token || token.split('.').length !== 3) {
    throw new Error('Invalid Tochka webhook: not a JWT');
  }

  const jwks = getJwks();
  if (jwks) {
    const { payload } = await jwtVerify(token, jwks);
    return { payload: payload as any, signatureVerified: true };
  }

  const pem = process.env.TOCHKA_WEBHOOK_PUBLIC_KEY;
  if (pem) {
    const key = await importSPKI(pem.replace(/\\n/g, '\n'), 'RS256');
    const { payload } = await jwtVerify(token, key);
    return { payload: payload as any, signatureVerified: true };
  }

  // Ключ не сконфигурирован — декодируем без верификации.
  console.warn(
    '[Tochka] TOCHKA_WEBHOOK_JWKS_URL/PUBLIC_KEY не заданы — подпись вебхука не проверяется. Авто-проброс в RetailCRM отключён для этого платежа.',
  );
  const payload = decodeJwt(token) as any;
  return { payload, signatureVerified: false };
}

// Схема полезной нагрузки вебхука Точки (входящий платёж).
// Поля различаются между incomingPayment и СБП; берём то, что есть, остальное — из raw.
const TochkaPaymentSchema = z
  .object({
    webhookType: z.string().optional(),
    customerCode: z.union([z.string(), z.number()]).optional(),
    // Идентификатор платежа встречается под разными именами.
    paymentId: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    // Сумма.
    amount: z.union([z.string(), z.number()]).optional(),
    sum: z.union([z.string(), z.number()]).optional(),
    // Назначение платежа.
    purpose: z.string().optional(),
    paymentPurpose: z.string().optional(),
    // Дата.
    date: z.string().optional(),
    paymentDate: z.string().optional(),
    executionDate: z.string().optional(),
    // Номер документа.
    documentNumber: z.union([z.string(), z.number()]).optional(),
    number: z.union([z.string(), z.number()]).optional(),
    // Плательщик.
    payerName: z.string().optional(),
    sidePayerName: z.string().optional(),
    payerInn: z.union([z.string(), z.number()]).optional(),
    payerINN: z.union([z.string(), z.number()]).optional(),
    payerKpp: z.union([z.string(), z.number()]).optional(),
    payerKPP: z.union([z.string(), z.number()]).optional(),
    payerAccount: z.string().optional(),
    payerBankBic: z.union([z.string(), z.number()]).optional(),
    payerBankBik: z.union([z.string(), z.number()]).optional(),
    payerBankName: z.string().optional(),
    // Наш счёт.
    accountId: z.string().optional(),
    account: z.string().optional(),
  })
  .passthrough();

function str(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function toIsoDate(value?: string | null): string | null {
  if (!value) return null;
  // Точка обычно отдаёт YYYY-MM-DD; пропускаем как есть, если распознаётся.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function isIncomingTochkaWebhook(webhookType?: string | null): boolean {
  return !!webhookType && INCOMING_WEBHOOK_TYPES.has(webhookType);
}

/**
 * Приводит payload вебхука Точки к нормализованному платежу.
 * Возвращает null, если событие не является входящим платежом
 * (исходящие/эквайринг игнорируем) или нет обязательных полей.
 */
export function normalizeTochkaPayment(
  rawPayload: Record<string, any>,
  signatureVerified: boolean,
): NormalizedPointPayment | null {
  const parsed = TochkaPaymentSchema.safeParse(rawPayload);
  const p: any = parsed.success ? parsed.data : rawPayload;

  const webhookType = str(p.webhookType);
  if (webhookType && !isIncomingTochkaWebhook(webhookType)) {
    return null; // не входящий платёж — не наш случай
  }

  const externalPaymentId = str(p.paymentId) || str(p.id);
  if (!externalPaymentId) return null;

  const amountKopecks = parseAmountToKopecks(p.amount ?? p.sum);
  if (amountKopecks === null) return null;

  const paymentDate = toIsoDate(str(p.date) || str(p.paymentDate) || str(p.executionDate));

  return {
    source: 'tochka',
    externalPaymentId,
    webhookType,
    customerCode: str(p.customerCode),
    amountKopecks,
    currency: 'RUB',
    paymentDate,
    paymentDatetime: paymentDate ? new Date(`${paymentDate}T00:00:00Z`).toISOString() : null,
    purpose: str(p.purpose) || str(p.paymentPurpose),
    documentNumber: str(p.documentNumber) || str(p.number),
    payerName: str(p.payerName) || str(p.sidePayerName),
    payerInn: str(p.payerInn) || str(p.payerINN),
    payerKpp: str(p.payerKpp) || str(p.payerKPP),
    payerAccount: str(p.payerAccount),
    payerBankBic: str(p.payerBankBic) || str(p.payerBankBik),
    payerBankName: str(p.payerBankName),
    accountId: str(p.accountId) || str(p.account),
    signatureVerified,
    rawPayload,
  };
}
