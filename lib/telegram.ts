// ОТВЕТСТВЕННЫЙ: ИГОРЬ (Диспетчер) — Внешняя коммуникация, отправка алертов и отчетов в Telegram.

/**
 * Токен бота: имена переменных на проде и локально разные.
 *
 * На Vercel он живёт как TELEGRAM_PAYMENTS_BOT_TOKEN, в .env.local — как
 * TELEGRAM_BOT_TOKEN. Код, знающий только второе имя, работает на машине
 * разработчика и молча молчит в проде: ровно так у Тамары не ушёл ежедневный
 * отчёт, хотя накануне проверка с ноутбука дошла.
 *
 * Бот один на весь сервис, поэтому и выбор токена должен быть один — здесь.
 */
export function telegramBotToken(): string | undefined {
    return process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(chatId: string, text: string) {
    const token = telegramBotToken();

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
 * Отправка файла (sendDocument). В отличие от sendTelegramMessage — БРОСАЕТ ошибку:
 * отчёт в бухгалтерию не должен «молча не уйти», вызывающий обязан показать провал.
 * token — по умолчанию бот Игоря; передай другой, если шлёшь от бота уведомлений.
 */
export async function sendTelegramDocument(params: {
    chatId: string;
    filename: string;
    file: ArrayBuffer | Uint8Array;
    caption?: string;
    token?: string;
    threadId?: string;
    contentType?: string;
}) {
    const token = params.token || telegramBotToken();
    if (!token) throw new Error('Не задан токен Telegram-бота');
    if (!params.chatId) throw new Error('Не задан chat_id получателя');

    const form = new FormData();
    form.append('chat_id', params.chatId);
    if (params.threadId) form.append('message_thread_id', params.threadId);
    if (params.caption) {
        form.append('caption', params.caption);
        form.append('parse_mode', 'HTML');
    }
    const bytes = new Uint8Array(params.file instanceof Uint8Array ? params.file : new Uint8Array(params.file));
    form.append(
        'document',
        new Blob([bytes], { type: params.contentType || 'application/octet-stream' }),
        params.filename,
    );

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
        throw new Error(`Telegram sendDocument: ${res.status} ${json?.description || (await res.text().catch(() => ''))}`);
    }
    return json.result;
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
