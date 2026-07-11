import { NextRequest, NextResponse } from 'next/server';
import {
  getTbankConfig,
  getTbankAccounts,
  getTbankOperations,
  normalizeTbankOperation,
} from '@/lib/payments/tbank';
import { ingestPointPayment, processPointPayment } from '@/lib/payments/service';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

// Крон-воркер Т-Банка: тянет выписку по расчётным счетам за скользящее окно,
// записывает входящие платежи (идемпотентно по operationId) и сразу разносит
// (матчинг + проброс в RetailCRM). Ретрай не-проброшенных берёт на себя общий
// воркер point-payment-ingest — здесь только приём и первичная обработка.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.tbank_statement_poll';

// Окно опроса: с перекрытием, чтобы не терять поздно проведённые операции.
// Дубли отсекает уникальный индекс (source, external_payment_id).
const WINDOW_DAYS = Number(process.env.TBANK_POLL_WINDOW_DAYS || 3);

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    const cfg = getTbankConfig();
    if (!cfg) {
      // Токен не задан — деградируем мягко, не роняем крон.
      return NextResponse.json({ ok: true, status: 'disabled', reason: 'TBANK_API_TOKEN не задан' });
    }

    const now = new Date();
    // /v1/statement ждёт date-time — передаём полный ISO 8601.
    const from = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const accounts = await getTbankAccounts(cfg);
    if (!accounts.length) {
      await recordWorkerSuccess(WORKER_KEY, { accounts: 0, ingested: 0 });
      return NextResponse.json({ ok: true, status: 'idle', reason: 'нет доступных счетов' });
    }

    let ingested = 0;
    let matched = 0;
    let pending = 0;
    let seen = 0;
    const details: Array<Record<string, any>> = [];

    // Счетов немного — идём последовательно, чтобы не упереться в рейт-лимит (statement 20 rps).
    for (const account of accounts) {
      let accIngested = 0;
      let operations: any[] = [];
      try {
        operations = await getTbankOperations(cfg, account, from, to);
      } catch (e: any) {
        details.push({ account, error: String(e?.message || e).slice(0, 300) });
        continue;
      }

      for (const op of operations) {
        const normalized = normalizeTbankOperation(op, account);
        if (!normalized) continue; // не входящий / нет ключевых данных
        seen++;
        try {
          const { row, isNew } = await ingestPointPayment(normalized);
          if (!isNew) continue; // уже принимали в прошлый проход
          accIngested++;
          ingested++;
          const res = await processPointPayment(row).catch(() => ({ status: row.status }));
          if (res.status === 'matched' || res.status === 'manual') matched++;
          else pending++;
        } catch {
          /* пропускаем сбойную операцию, не роняя проход */
        }
      }
      details.push({ account, operations: operations.length, ingested: accIngested });
    }

    await recordWorkerSuccess(WORKER_KEY, { accounts: accounts.length, ingested, matched, pending });
    return NextResponse.json({ ok: true, status: 'processed', from, to, seen, ingested, matched, pending, details });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'tbank statement poll route error');
    }
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.message === 'Unauthorized' ? 401 : 500 },
    );
  }
}
