import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/cron/rop-bind — привязка личных чатов менеджеров.
//
// Telegram не даёт боту написать первым: пока человек сам не напишет боту,
// личного чата не существует. Этот обработчик читает свежие сообщения бота и
// связывает их с менеджерами по нику из RetailCRM — тому же, по которому мы их
// тегаем. Человеку достаточно один раз нажать «Старт».
//
// Нарочно не webhook: у бота уже может быть свой обработчик, и перехватывать
// его ради одной привязки — верный способ сломать оплаты.

export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return NextResponse.json({ ok: false, error: 'Нет токена бота' }, { status: 500 });

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100`);
        const data: any = await res.json();

        // Ники менеджеров лежат там же, откуда мы берём теги.
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name, raw_data')
            .eq('active', true);

        const byUsername = new Map<string, number>();
        for (const m of (managers ?? []) as any[]) {
            const nick = String(m.raw_data?.telegram_username || '').replace(/^@/, '').toLowerCase();
            if (nick) byUsername.set(nick, Number(m.id));
        }

        const bound: string[] = [];
        for (const update of data.result ?? []) {
            const msg = update.message || update.edited_message;
            if (msg?.chat?.type !== 'private') continue;
            const nick = String(msg.chat.username || '').toLowerCase();
            const managerId = byUsername.get(nick);
            if (!managerId) continue;

            await supabase.from('sales_rop_manager').upsert(
                {
                    manager_id: managerId,
                    telegram_chat_id: String(msg.chat.id),
                    telegram_username: nick,
                    started_at: new Date().toISOString(),
                    is_active: true,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'manager_id' },
            );
            bound.push(nick);
        }

        return NextResponse.json({ ok: true, bound: Array.from(new Set(bound)) });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
