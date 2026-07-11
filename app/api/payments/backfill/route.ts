import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import {
  getTochkaAccounts,
  createTochkaStatement,
  getTochkaStatement,
  normalizeStatementTransaction,
} from '@/lib/payments/tochka-statement';
import { ingestPointPayment } from '@/lib/payments/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const READY_STATUSES = new Set(['created', 'ready', 'booked', 'done', 'success']);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// POST /api/payments/backfill { from, to } — тянет выписку Точки за период и
// записывает входящие платежи в очередь (дальше их разносит крон-воркер).
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Укажите период from/to (YYYY-MM-DD)' }, { status: 400 });
    }
    const { from, to } = parsed.data;

    let accounts: string[];
    try {
      accounts = await getTochkaAccounts();
    } catch (e: any) {
      return NextResponse.json({ error: `Не удалось получить счета: ${e.message}` }, { status: 502 });
    }
    if (!accounts.length) {
      return NextResponse.json({ error: 'У ключа нет доступных счетов' }, { status: 400 });
    }

    const details: Array<Record<string, any>> = [];
    let ingested = 0;

    for (const accountId of accounts) {
      const created = await createTochkaStatement(accountId, from, to);

      // Полная выписка недоступна по JWT — нужен OAuth.
      if (!created.statementId) {
        if (created.status === 501) {
          return NextResponse.json(
            {
              error:
                'Полная выписка требует OAuth (JWT возвращает 501). Настройте OAuth+Consent в Точке, чтобы тянуть исторические переводы.',
              needs_oauth: true,
              account: accountId,
              tochka: created.data,
            },
            { status: 501 },
          );
        }
        details.push({ account: accountId, error: 'no statementId', status: created.status, tochka: created.data });
        continue;
      }

      // Ждём готовности выписки (bounded polling).
      let transactions: any[] = [];
      let lastStatus: string | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const stmt = await getTochkaStatement(accountId, created.statementId);
        lastStatus = stmt.stmtStatus;
        if (stmt.transactions.length > 0 || (lastStatus && READY_STATUSES.has(lastStatus.toLowerCase()))) {
          transactions = stmt.transactions;
          break;
        }
        await sleep(3000);
      }

      let accIngested = 0;
      for (const txn of transactions) {
        const normalized = normalizeStatementTransaction(txn, accountId);
        if (!normalized) continue; // не входящий/без обязательных полей
        try {
          await ingestPointPayment(normalized);
          accIngested++;
          ingested++;
        } catch {
          /* пропускаем сбойную транзакцию */
        }
      }

      details.push({
        account: accountId,
        statement_id: created.statementId,
        statement_status: lastStatus,
        transactions: transactions.length,
        ingested: accIngested,
      });
    }

    return NextResponse.json({ ok: true, from, to, ingested, details });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
