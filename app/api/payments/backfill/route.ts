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

// «Created» = запрос принят и ещё готовится; готово — только «Ready».
const READY_STATUSES = new Set(['ready', 'done', 'success']);

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

    // Фаза 1: создаём выписки по всем счетам (параллельно).
    const created = await Promise.all(
      accounts.map(async (accountId) => ({ accountId, ...(await createTochkaStatement(accountId, from, to)) })),
    );

    // Если выписка требует OAuth — на JWT вернётся 501 по всем счетам.
    if (created.every((c) => !c.statementId) && created.some((c) => c.status === 501)) {
      return NextResponse.json(
        {
          error:
            'Полная выписка требует OAuth (JWT возвращает 501). Настройте OAuth+Consent в Точке, чтобы тянуть исторические переводы.',
          needs_oauth: true,
          tochka: created[0]?.data,
        },
        { status: 501 },
      );
    }

    // Фаза 2: ждём готовности (Ready) и забираем транзакции — параллельно по счетам.
    const collect = async (accountId: string, statementId: string) => {
      let lastStatus: string | null = null;
      for (let attempt = 0; attempt < 25; attempt++) {
        const stmt = await getTochkaStatement(accountId, statementId);
        lastStatus = stmt.stmtStatus;
        const ready = lastStatus && READY_STATUSES.has(lastStatus.toLowerCase());
        if (ready || stmt.transactions.length > 0) {
          return { transactions: stmt.transactions, lastStatus };
        }
        await sleep(3000);
      }
      return { transactions: [] as any[], lastStatus };
    };

    const collected = await Promise.all(
      created.map(async (c) => {
        if (!c.statementId) {
          return { account: c.accountId, error: 'no statementId', status: c.status, transactions: 0, ingested: 0 };
        }
        const { transactions, lastStatus } = await collect(c.accountId, c.statementId);
        return { account: c.accountId, statement_id: c.statementId, statement_status: lastStatus, transactions, ingested: 0 };
      }),
    );

    // Запись входящих (Credit) платежей. Идемпотентно по paymentId.
    let ingested = 0;
    const details: Array<Record<string, any>> = [];
    for (const c of collected as any[]) {
      let accIngested = 0;
      const txns: any[] = Array.isArray(c.transactions) ? c.transactions : [];
      for (const txn of txns) {
        const normalized = normalizeStatementTransaction(txn, c.account);
        if (!normalized) continue;
        try {
          await ingestPointPayment(normalized);
          accIngested++;
          ingested++;
        } catch {
          /* пропускаем сбойную транзакцию */
        }
      }
      details.push({
        account: c.account,
        statement_id: c.statement_id,
        statement_status: c.statement_status,
        transactions: txns.length,
        ingested: accIngested,
        ...(c.error ? { error: c.error, status: c.status } : {}),
      });
    }

    return NextResponse.json({ ok: true, from, to, ingested, details });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
