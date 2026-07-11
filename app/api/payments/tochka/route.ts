import { NextRequest, NextResponse } from 'next/server';
import {
  decodeTochkaWebhookResilient,
  normalizeTochkaPayment,
} from '@/lib/payments/tochka';
import { ingestPointPayment } from '@/lib/payments/service';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

// Диагностика: сохраняем сырьё последнего вебхука в sync_state, чтобы видеть,
// что реально шлёт Точка (даже если приёмник не смог распознать платёж).
async function captureLastWebhook(data: Record<string, any>) {
  try {
    const value = JSON.stringify(data).slice(0, 8000);
    await supabase
      .from('sync_state')
      .upsert(
        { key: 'payments.tochka_last_webhook', value, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
  } catch {
    /* диагностика не должна ломать приём */
  }
}

// Публичный вебхук банка Точка (Точка.API): входящие платежи.
// Приём тонкий: проверяем/декодируем JWT, нормализуем, идемпотентно сохраняем
// строку в point_payments (status=pending_match) и сразу отвечаем 200.
// Матчинг и проброс в RetailCRM выполняет крон-воркер (point-payment-ingest).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const WORKER_KEY = 'payments.tochka_webhook';

// Опциональная первая линия защиты: общий секрет в query (?secret=) или заголовке.
function ensureWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.TOCHKA_WEBHOOK_SECRET;
  if (!expected) return true; // не настроен — полагаемся на проверку подписи JWT
  const provided =
    new URL(req.url).searchParams.get('secret') ||
    req.headers.get('x-webhook-secret') ||
    '';
  return provided === expected;
}

// Точка при настройке вебхука может дёрнуть GET для проверки доступности.
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  try {
    if (!ensureWebhookSecret(req)) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const rawBody = (await req.text()).trim();
    // Сразу фиксируем сырое тело — на случай, если это вообще не JWT.
    await captureLastWebhook({ at: new Date().toISOString(), stage: 'raw_body', body: rawBody.slice(0, 4000) });
    if (!rawBody) {
      return NextResponse.json({ ok: false, error: 'empty body' }, { status: 400 });
    }

    // Тело вебхука — JWT. Иногда приходит как form/json-обёртка — достаём токен.
    let token = rawBody;
    if (rawBody.startsWith('{')) {
      try {
        const obj = JSON.parse(rawBody);
        token = obj.token || obj.jwt || obj.data || rawBody;
      } catch {
        /* оставляем как есть */
      }
    }

    const { payload, signatureVerified } = await decodeTochkaWebhookResilient(token);

    const normalized = normalizeTochkaPayment(payload, signatureVerified);
    // Фиксируем декодированный payload и результат распознавания.
    await captureLastWebhook({
      at: new Date().toISOString(),
      stage: 'decoded',
      signature_verified: signatureVerified,
      recognized: Boolean(normalized),
      payload,
    });
    if (!normalized) {
      // Не входящий платёж (исходящий/эквайринг/служебное) — просто подтверждаем.
      await recordWorkerSuccess(WORKER_KEY, { ignored: true });
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { row, isNew } = await ingestPointPayment(normalized);

    await recordWorkerSuccess(WORKER_KEY, {
      payment_id: row.id,
      external_payment_id: normalized.externalPaymentId,
      is_new: isNew,
      signature_verified: signatureVerified,
    });

    return NextResponse.json({ ok: true, payment_id: row.id, is_new: isNew });
  } catch (error: any) {
    await recordWorkerFailure(WORKER_KEY, error?.message || 'tochka webhook error');
    return NextResponse.json(
      { ok: false, error: error?.message || 'internal error' },
      { status: 500 },
    );
  }
}
