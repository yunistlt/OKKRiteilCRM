import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  getTbankConfig,
  getTbankAccounts,
  getTbankOperations,
  normalizeTbankOperation,
} from '@/lib/payments/tbank';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/payments/tbank/probe?days=3
// Диагностика: дёргает реальный ответ Т-Банка (счета + первые операции выписки),
// показывает СЫРЬЁ операции рядом с нормализованным видом — чтобы сверить имена полей
// (направление, сумма, назначение, плательщик) ДО того, как довериться авто-матчу.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const cfg = getTbankConfig();
    if (!cfg) {
      return NextResponse.json({ error: 'TBANK_API_TOKEN не задан в окружении Vercel' }, { status: 400 });
    }

    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 3, 1), 31);
    const now = new Date();
    // /v1/statement ждёт date-time — передаём полный ISO 8601.
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const accounts = await getTbankAccounts(cfg);

    const perAccount: Array<Record<string, any>> = [];
    for (const account of accounts.slice(0, 5)) {
      let operations: any[] = [];
      let error: string | null = null;
      try {
        operations = await getTbankOperations(cfg, account, from, to);
      } catch (e: any) {
        error = String(e?.message || e).slice(0, 400);
      }
      const sample = operations.slice(0, 5);
      perAccount.push({
        account,
        total_operations: operations.length,
        error,
        // Сырьё vs нормализация — сравниваем поля глазами.
        sample: sample.map((op) => ({
          raw: op,
          normalized: normalizeTbankOperation(op, account),
          skipped_reason: normalizeTbankOperation(op, account) ? null : 'не входящий / нет ключевых полей',
        })),
      });
    }

    return NextResponse.json({ ok: true, from, to, accounts, per_account: perAccount });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
