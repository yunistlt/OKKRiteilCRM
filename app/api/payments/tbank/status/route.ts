import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTbankConfig, getTbankAccounts, isTbankConfigured } from '@/lib/payments/tbank';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/payments/tbank/status — быстрая проверка связи с Т-Банком.
// Дёргает список расчётных счетов по токену: если пришли — связь есть.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    if (!isTbankConfigured()) {
      return NextResponse.json({
        ok: false,
        configured: false,
        error: 'TBANK_API_TOKEN не задан в окружении Vercel',
      });
    }

    const cfg = getTbankConfig()!;
    try {
      const accounts = await getTbankAccounts(cfg);
      return NextResponse.json({
        ok: true,
        configured: true,
        connected: true,
        accounts_count: accounts.length,
        accounts,
        base: cfg.base,
      });
    } catch (e: any) {
      // Токен есть, но банк ответил ошибкой — показываем как есть (диагностика).
      return NextResponse.json({
        ok: false,
        configured: true,
        connected: false,
        error: String(e?.message || e).slice(0, 500),
      });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
