import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import {
  getTochkaAccountsRaw,
  getTochkaCustomerRaw,
  getTochkaRecipientMap,
  accountBase,
} from '@/lib/payments/tochka-statement';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET /api/payments/tochka/recipients — диагностика: сырьё /accounts + первый /customers
// + построенная карta «счёт → юрлицо». Смотрим, под какими полями Точка отдаёт имя.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const raw = await getTochkaAccountsRaw();
    const accounts: any[] = raw.data?.Data?.Account || raw.data?.Data?.accounts || [];
    const firstCc =
      accounts.map((a) => a?.customerCode || a?.CustomerCode).find(Boolean) || null;
    const customerSample = firstCc ? await getTochkaCustomerRaw(String(firstCc)) : null;

    const map = await getTochkaRecipientMap();
    const mapObj = Object.fromEntries(Array.from(map.entries()));

    return NextResponse.json({
      ok: raw.ok,
      accounts_status: raw.status,
      accounts_raw: raw.data,
      customer_sample: customerSample?.data ?? null,
      recipient_map: mapObj,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/payments/tochka/recipients — бэкофилл получателя в существующих платежах Точки
// по карте «счёт → юрлицо». Обновляет только строки с известным счётом и найденным именем.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const map = await getTochkaRecipientMap();
    if (map.size === 0) {
      return NextResponse.json({ error: 'Пустая карта счетов Точки (нет данных от API)' }, { status: 502 });
    }

    // Берём все строки Точки без получателя.
    const { data: rows, error } = await supabase
      .from('point_payments')
      .select('id, account_id, recipient_name')
      .eq('source', 'tochka')
      .is('recipient_name', null)
      .limit(5000);
    if (error) throw error;

    let updated = 0;
    for (const r of rows || []) {
      const base = accountBase(r.account_id);
      const rec = base ? map.get(base) : null;
      if (!rec?.name) continue;
      const { error: uErr } = await supabase
        .from('point_payments')
        .update({ recipient_name: rec.name, recipient_inn: rec.inn ?? null, updated_at: new Date().toISOString() })
        .eq('id', r.id);
      if (!uErr) updated++;
    }

    return NextResponse.json({ ok: true, accounts_in_map: map.size, candidates: rows?.length || 0, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
