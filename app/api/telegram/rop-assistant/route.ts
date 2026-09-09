import { NextRequest, NextResponse } from 'next/server';
import { askSemen, managerByChat } from '@/lib/sales-rop/assistant';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/telegram/rop-assistant — Семён отвечает менеджеру в личке.
//
// Сюда Telegram присылает входящие сообщения бота. Отвечаем только на личные
// сообщения от менеджеров, которым бот шлёт планы: у Семёна есть инструменты по
// заказам и зарплате, и отдавать их случайному человеку, написавшему боту,
// нельзя.
//
// Секрет проверяется заголовком, который Telegram шлёт сам (secret_token при
// setWebhook): открытый обработчик webhook — это приглашение слать нам что
// угодно от чужого имени.

async function reply(chatId: number, text: string, replyTo?: number): Promise<void> {
    const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
            ...(replyTo ? { reply_to_message_id: replyTo } : {}),
        }),
    });
}

export async function POST(req: NextRequest) {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
        return NextResponse.json({ ok: false }, { status: 401 });
    }

    let update: any;
    try {
        update = await req.json();
    } catch {
        return NextResponse.json({ ok: true });
    }

    const msg = update?.message;
    // Всегда отвечаем Telegram 200: иначе он будет слать это обновление снова и
    // снова, а мы каждый раз честно падать на том же месте.
    if (!msg || msg.chat?.type !== 'private' || !msg.text) return NextResponse.json({ ok: true });

    const chatId = Number(msg.chat.id);
    const text = String(msg.text).trim();
    if (text.startsWith('/start')) {
        await reply(chatId, 'Привет! Сюда буду присылать план на день. Можешь спрашивать про заказы и клиентов — отвечу по данным CRM.');
        return NextResponse.json({ ok: true });
    }

    try {
        const manager = await managerByChat(String(chatId));
        if (!manager) {
            await reply(chatId, 'Я отвечаю только менеджерам отдела продаж. Если это ты — напиши Андрею, он подключит.');
            return NextResponse.json({ ok: true });
        }

        const answer = await askSemen({ question: text, managerId: manager.managerId, managerName: manager.name });
        await reply(chatId, answer.reply, msg.message_id);
        return NextResponse.json({ ok: true, tools: answer.usedTools });
    } catch (e: any) {
        await reply(chatId, 'Не смог ответить — что-то сломалось на моей стороне. Попробуй ещё раз чуть позже.');
        return NextResponse.json({ ok: true, error: e.message });
    }
}
