import { supabase } from '@/utils/supabase';
import { telegramBotToken } from '@/lib/telegram';

/**
 * Тамара пишет владельцу в телеграм.
 *
 * Разговор с ней был только в браузере: чтобы что-то узнать, надо было прийти и
 * спросить. Отчёт — обратный ход, она приходит сама.
 *
 * Два ограничения заложены в код, а не в инструкцию модели, потому что
 * инструкцию модель может понять по-своему.
 *
 * Адресат один — чат владельца из настроек. Инструмент не принимает чужой чат:
 * модель, умеющая писать кому угодно, однажды напишет не тому, и это будет
 * сообщение о делах компании постороннему человеку.
 *
 * Подпись добавляется здесь и всегда. Бот один на весь сервис: в том же чате
 * лежат утренние планы бота-РОПа и оповещения о сбоях. Без подписи непонятно,
 * кто это сказал, — а по её словам принимают решения.
 */

export type TamaraSettings = {
    chatId: string;
    dailyReportEnabled: boolean;
    dailyReportHour: number;
    signature: string;
};

export async function loadTamaraSettings(): Promise<TamaraSettings> {
    const { data } = await supabase.from('shtab_settings').select('key, value');
    const map = new Map(((data ?? []) as any[]).map((r) => [String(r.key), String(r.value ?? '')]));

    // Своего чата может не быть — тогда пишем туда же, куда уходит отчёт
    // бота-РОПа: это тот же владелец, и заводить второй чат ради одного
    // отправителя незачем.
    let chatId = map.get('telegram_chat_id') || '';
    if (!chatId) {
        const { data: rop } = await supabase
            .from('sales_rop_settings')
            .select('value')
            .eq('key', 'owner_chat_id')
            .maybeSingle();
        chatId = String((rop as any)?.value ?? '');
    }

    const hour = Number(map.get('daily_report_hour'));
    return {
        chatId,
        dailyReportEnabled: String(map.get('daily_report_enabled') ?? 'true') === 'true',
        dailyReportHour: Number.isFinite(hour) ? hour : 8,
        signature: map.get('telegram_signature') || 'Тамара, наставник',
    };
}

/** Телеграм режет длинные сообщения; лучше разбить самим, чем потерять хвост. */
const TELEGRAM_LIMIT = 3800;

function splitMessage(text: string): string[] {
    if (text.length <= TELEGRAM_LIMIT) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest.length > TELEGRAM_LIMIT) {
        // Режем по абзацу, а не по символу: разорванная посередине фраза
        // читается как сбой.
        const cut = rest.lastIndexOf('\n\n', TELEGRAM_LIMIT);
        const at = cut > TELEGRAM_LIMIT / 2 ? cut : rest.lastIndexOf('\n', TELEGRAM_LIMIT);
        const point = at > 0 ? at : TELEGRAM_LIMIT;
        parts.push(rest.slice(0, point).trim());
        rest = rest.slice(point).trim();
    }
    if (rest) parts.push(rest);
    return parts;
}

export type SendResult = { ok: boolean; parts: number; chatId: string; error?: string };

/**
 * Отправить владельцу. Подпись ставится всегда и последней строкой.
 *
 * Каждая отправка попадает в shtab_tamara_outbox — и удачная, и нет. Молчащий
 * отправитель неотличим от отправителя, которому нечего сказать.
 */
export async function sendToOwner(
    text: string,
    opts: { kind?: string; reportDate?: string | null } = {},
): Promise<SendResult> {
    const settings = await loadTamaraSettings();
    // Имя переменной с токеном на проде и локально разное — выбор один на
    // весь сервис, в lib/telegram.
    const token = telegramBotToken();

    if (!token || !settings.chatId) {
        const error = !token ? 'не настроен токен бота' : 'не задан чат владельца';
        await supabase.from('shtab_tamara_outbox').insert({
            kind: opts.kind ?? 'message',
            text,
            chat_id: settings.chatId || '—',
            report_date: opts.reportDate ?? null,
            ok: false,
            error,
        });
        return { ok: false, parts: 0, chatId: settings.chatId, error };
    }

    const body = `${text.trim()}\n\n— ${settings.signature}`;
    const parts = splitMessage(body);

    try {
        for (const part of parts) {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: settings.chatId,
                    text: part,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            });
            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                throw new Error(`телеграм ответил ${res.status}: ${detail.slice(0, 200)}`);
            }
        }

        await supabase.from('shtab_tamara_outbox').insert({
            kind: opts.kind ?? 'message',
            text: body,
            chat_id: settings.chatId,
            report_date: opts.reportDate ?? null,
            ok: true,
        });
        return { ok: true, parts: parts.length, chatId: settings.chatId };
    } catch (e: any) {
        const error = String(e?.message ?? e);
        await supabase.from('shtab_tamara_outbox').insert({
            kind: opts.kind ?? 'message',
            text: body,
            chat_id: settings.chatId,
            report_date: opts.reportDate ?? null,
            ok: false,
            error,
        });
        return { ok: false, parts: 0, chatId: settings.chatId, error };
    }
}

/** Прошлые отчёты — чтобы форма не менялась каждый день без причины. */
export async function recentReports(limit = 3): Promise<Array<{ date: string | null; text: string }>> {
    const { data } = await supabase
        .from('shtab_tamara_outbox')
        .select('report_date, text, sent_at')
        .eq('kind', 'daily_report')
        .eq('ok', true)
        .order('sent_at', { ascending: false })
        .limit(limit);

    return ((data ?? []) as any[]).map((r) => ({
        date: r.report_date ?? null,
        text: String(r.text ?? ''),
    }));
}

/** Уже отчитывались за этот день? Крон может отработать дважды. */
export async function reportSentFor(date: string): Promise<boolean> {
    const { data } = await supabase
        .from('shtab_tamara_outbox')
        .select('id')
        .eq('kind', 'daily_report')
        .eq('report_date', date)
        .eq('ok', true)
        .maybeSingle();
    return Boolean(data);
}
