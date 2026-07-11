import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import {
  getOurWebhookUrl,
  getTochkaWebhooks,
  subscribeTochkaWebhook,
  testSendTochkaWebhook,
} from '@/lib/payments/tochka-admin';

// Последнее сырьё, полученное на наш вебхук (для диагностики формата Точки).
async function getLastWebhook() {
  try {
    const { data } = await supabase
      .from('sync_state')
      .select('value, updated_at')
      .eq('key', 'payments.tochka_last_webhook')
      .maybeSingle();
    if (!data?.value) return null;
    try {
      return { updated_at: data.updated_at, ...JSON.parse(data.value) };
    } catch {
      return { updated_at: data.updated_at, value: data.value };
    }
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

// GET  /api/payments/subscribe  → текущее состояние подписки на вебхуки Точки
// POST /api/payments/subscribe  { action?: 'subscribe' | 'test' } → подключить/протестировать
// Доступ: только авторизованные (RBAC /api/payments → admin, rop). Токен Точки — из env на сервере.

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const ourUrl = getOurWebhookUrl(new URL(req.url).origin);
    const [current, lastWebhook] = await Promise.all([getTochkaWebhooks(), getLastWebhook()]);
    return NextResponse.json({ our_webhook_url: ourUrl, tochka: current, last_webhook: lastWebhook });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action || 'subscribe';
    const ourUrl = getOurWebhookUrl(new URL(req.url).origin);

    if (action === 'test') {
      const result = await testSendTochkaWebhook();
      return NextResponse.json({ action, result });
    }

    const result = await subscribeTochkaWebhook(ourUrl);
    return NextResponse.json({ action, our_webhook_url: ourUrl, result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
