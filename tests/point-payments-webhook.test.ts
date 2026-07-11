import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { generateKeyPair, exportSPKI, SignJWT, exportPKCS8, importPKCS8 } from 'jose';
import {
  verifyAndDecodeTochkaWebhook,
  decodeTochkaWebhookResilient,
  normalizeTochkaPayment,
} from '@/lib/payments/tochka';

// Проверка сквозного пути приёма вебхука Точки: подпись RS256 → верификация → нормализация.
// Ключи генерируются локально (без сети), Точкин публичный ключ имитируется нашим.

let publicPem: string;
let privatePkcs8: string;

const SAMPLE = {
  webhookType: 'incomingPayment',
  customerCode: '300000000',
  paymentId: '10730323',
  amount: '484898.30',
  purpose: 'ОПЛАТА ПО СЧЕТУ №53433 ОТ 08.06.2026Г СУММА 484898-30В Т.Ч. НДС(5%) 23090-40',
  date: '2026-07-10',
  payerName: 'ООО "АГРОПРОМСЕРВИС"',
  payerInn: '463217526',
  documentNumber: '3685',
};

async function signSample(privatePem: string, payload: Record<string, any>) {
  const key = await importPKCS8(privatePem, 'RS256');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(key);
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  publicPem = await exportSPKI(publicKey);
  privatePkcs8 = await exportPKCS8(privateKey);
});

afterEach(() => {
  delete process.env.TOCHKA_WEBHOOK_PUBLIC_KEY;
  delete process.env.TOCHKA_WEBHOOK_JWKS_URL;
});

describe('Tochka webhook — проверка подписи', () => {
  it('валидная подпись → signatureVerified=true и корректный payload', async () => {
    process.env.TOCHKA_WEBHOOK_PUBLIC_KEY = publicPem;
    const jwt = await signSample(privatePkcs8, SAMPLE);

    const { payload, signatureVerified } = await verifyAndDecodeTochkaWebhook(jwt);
    expect(signatureVerified).toBe(true);
    expect(payload.paymentId).toBe('10730323');

    const normalized = normalizeTochkaPayment(payload, signatureVerified);
    expect(normalized).not.toBeNull();
    expect(normalized!.amountKopecks).toBe(48489830);
    expect(normalized!.purpose).toContain('53433');
    expect(normalized!.signatureVerified).toBe(true);
  });

  it('поддельная подпись (чужой ключ) → ошибка верификации', async () => {
    process.env.TOCHKA_WEBHOOK_PUBLIC_KEY = publicPem;
    // Подписываем ДРУГИМ ключом — подпись не должна пройти проверку нашим публичным ключом.
    const { privateKey: otherPriv } = await generateKeyPair('RS256', { extractable: true });
    const otherPem = await exportPKCS8(otherPriv);
    const forged = await signSample(otherPem, SAMPLE);

    await expect(verifyAndDecodeTochkaWebhook(forged)).rejects.toThrow();
  });

  it('ключ не сконфигурирован → декодируется, но signatureVerified=false (авто-проброс запрещён)', async () => {
    const jwt = await signSample(privatePkcs8, SAMPLE);
    const { payload, signatureVerified } = await verifyAndDecodeTochkaWebhook(jwt);
    expect(signatureVerified).toBe(false);
    expect(payload.paymentId).toBe('10730323');
  });

  it('не-JWT тело → ошибка', async () => {
    await expect(verifyAndDecodeTochkaWebhook('не токен')).rejects.toThrow();
  });
});

describe('Tochka webhook — устойчивый приём (resilient)', () => {
  it('валидная подпись → verified=true', async () => {
    process.env.TOCHKA_WEBHOOK_PUBLIC_KEY = publicPem;
    const jwt = await signSample(privatePkcs8, SAMPLE);
    const { signatureVerified } = await decodeTochkaWebhookResilient(jwt);
    expect(signatureVerified).toBe(true);
  });

  it('НЕВЕРНЫЙ ключ в env → приём не падает, платёж помечается непроверенным', async () => {
    // Имитируем именно тот кейс: в переменную вставлено не то (не PEM-ключ).
    process.env.TOCHKA_WEBHOOK_PUBLIC_KEY = 'eyJhbGciOiJSUzI1NiJ9.не-ключ-а-токен';
    const jwt = await signSample(privatePkcs8, SAMPLE);
    const { payload, signatureVerified } = await decodeTochkaWebhookResilient(jwt);
    expect(signatureVerified).toBe(false);
    expect(payload.paymentId).toBe('10730323'); // payload всё равно разобран → уйдёт в ручной разбор
  });

  it('поддельная подпись → приём не падает, но verified=false', async () => {
    process.env.TOCHKA_WEBHOOK_PUBLIC_KEY = publicPem;
    const { privateKey: otherPriv } = await generateKeyPair('RS256', { extractable: true });
    const otherPem = await exportPKCS8(otherPriv);
    const forged = await signSample(otherPem, SAMPLE);
    const { signatureVerified } = await decodeTochkaWebhookResilient(forged);
    expect(signatureVerified).toBe(false);
  });

  it('не-JWT тело → всё же ошибка', async () => {
    await expect(decodeTochkaWebhookResilient('мусор')).rejects.toThrow();
  });
});
