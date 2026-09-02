/**
 * Показать владельцу, что именно уходит менеджерам вечером.
 *
 * Прогон идёт в режиме без рассылки: менеджерам ничего не отправляется, в базу
 * ничего не пишется. Тексты собираются те же самые и уходят одному человеку —
 * владельцу, в его личный чат из настроек.
 *
 * Запуск: npx tsx scripts/send-evening-preview.ts [дата]
 */
import { config } from 'dotenv';

// Переменные окружения читаются модулем supabase на импорте, поэтому сначала
// .env.local, и только потом — динамический импорт самого прогона.
config({ path: '.env.local' });

const TG = 'https://api.telegram.org';

async function send(chatId: string, text: string): Promise<void> {
    const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('нет токена бота');
    const res = await fetch(`${TG}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram → ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Телеграм режет сообщения длиннее 4096 символов — бьём по строкам. */
function chunks(text: string, limit = 3800): string[] {
    const out: string[] = [];
    let cur = '';
    for (const line of text.split('\n')) {
        if ((cur + '\n' + line).length > limit) {
            out.push(cur);
            cur = line;
        } else {
            cur = cur ? `${cur}\n${line}` : line;
        }
    }
    if (cur) out.push(cur);
    return out;
}

async function main() {
    const args = process.argv.slice(2);
    const printOnly = args.includes('--print');
    const today = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
    const { loadSettings, runEvening } = await import('../lib/sales-rop/service');
    const settings = await loadSettings();
    const owner = settings.ownerChatId || settings.chatId;
    if (!owner) throw new Error('не задан чат владельца');

    const result = await runEvening(today, { dryRun: true });
    // preview: шапка, затем по сообщению на менеджера, последним — отчёт владельцу.
    const personal = result.preview.slice(1, -1);

    console.log(`день ${today}, сообщений менеджерам: ${personal.length}`);
    if (result.degraded.length) console.log('не собралось:', result.degraded.join('; '));

    if (printOnly) {
        console.log(personal.join('\n\n— — — — —\n\n'));
        return;
    }

    await send(owner, `📬 Вот что уходит менеджерам вечером (${today}). Сообщений: ${personal.length}.`);
    for (const text of personal) {
        for (const part of chunks(text)) await send(owner, part);
    }
    console.log('отправлено владельцу:', owner);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
