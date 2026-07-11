import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import {
  getTbankConfig,
  getTbankAccounts,
  getTbankOperations,
  normalizeTbankOperation,
} from '@/lib/payments/tbank';
import { ingestPointPayment, processPointPayment } from '@/lib/payments/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// POST /api/payments/tbank/backfill { from, to } — ручная загрузка выписки Т-Банка за период.
// Выписка T-API синхронная (не как асинхронная выписка Точки): сразу тянем операции,
// пишем входящие (идемпотентно по operationId) и разносим (матчинг + проброс в RetailCRM).
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Укажите период from/to (YYYY-MM-DD)' }, { status: 400 });
    }
    const { from, to } = parsed.data;

    const cfg = getTbankConfig();
    if (!cfg) {
      return NextResponse.json({ error: 'TBANK_API_TOKEN не задан в окружении Vercel' }, { status: 400 });
    }

    // /v1/statement ждёт date-time; берём весь диапазон включительно.
    const fromIso = `${from}T00:00:00Z`;
    const toIso = `${to}T23:59:59Z`;

    let accounts: string[];
    try {
      accounts = await getTbankAccounts(cfg);
    } catch (e: any) {
      return NextResponse.json({ error: `Не удалось получить счета: ${e.message}` }, { status: 502 });
    }
    if (!accounts.length) {
      return NextResponse.json({ error: 'У токена нет доступных счетов' }, { status: 400 });
    }

    let ingested = 0;
    let matched = 0;
    let pending = 0;
    const details: Array<Record<string, any>> = [];

    for (const account of accounts) {
      let accIngested = 0;
      let operations: any[] = [];
      try {
        operations = await getTbankOperations(cfg, account, fromIso, toIso);
      } catch (e: any) {
        details.push({ account, error: String(e?.message || e).slice(0, 300) });
        continue;
      }

      for (const op of operations) {
        const normalized = normalizeTbankOperation(op, account);
        if (!normalized) continue; // не входящий / нет ключевых данных
        try {
          const { row, isNew } = await ingestPointPayment(normalized);
          accIngested++;
          ingested++;
          if (isNew) {
            const res = await processPointPayment(row).catch(() => ({ status: row.status }));
            if (res.status === 'matched' || res.status === 'manual') matched++;
            else pending++;
          }
        } catch {
          /* пропускаем сбойную операцию */
        }
      }
      details.push({ account, operations: operations.length, ingested: accIngested });
    }

    return NextResponse.json({ ok: true, from, to, ingested, matched, pending, details });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
