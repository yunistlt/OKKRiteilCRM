// ОТВЕТСТВЕННЫЙ: ИГОРЬ (Диспетчер) — Внешняя коммуникация, отправка алертов и отчетов в Telegram.
export async function sendTelegramMessage(chatId: string, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token || !chatId) {
        console.warn('[Telegram] Credentials not found. Skipping notification.');
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Telegram error: ${res.status} ${errText}`);
        }
    } catch (e) {
        console.error('[Telegram] Failed to send message:', e);
    }
}

/**
 * Legacy wrapper for Igor's notifications using default TELEGRAM_CHAT_ID
 */
export async function sendTelegramNotification(message: string) {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
        console.warn('[Telegram] TELEGRAM_CHAT_ID not set for default notification.');
        return;
    }
    return sendTelegramMessage(chatId, message);
}
