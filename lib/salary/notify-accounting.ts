// Отправка расчётной ведомости в Telegram бухгалтерии.
// Общее ядро для двух входов: автоматом при закрытии периода (/api/salary/close)
// и вручную кнопкой «В бухгалтерию» (/api/salary/send-to-accounting).
import { supabase } from '@/utils/supabase';
import { buildPayrollWorkbook } from '@/lib/salary/export';
import { getAccountingRecipients } from '@/lib/salary/config';
import { sendTelegramDocument } from '@/lib/telegram';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

// Ведомость шлём от бота уведомлений (@okkzmk_bot) — у него уже есть рабочие чаты;
// фолбэк — бот Игоря.
function botToken(): string | undefined {
    return process.env.TELEGRAM_SALARY_BOT_TOKEN
        || process.env.TELEGRAM_PAYMENTS_BOT_TOKEN
        || process.env.TELEGRAM_BOT_TOKEN;
}

export interface AccountingDelivery {
    ok: boolean;
    /** Кому ушло (имена получателей). */
    sent: string[];
    failed: { name: string; error: string }[];
    /** Почему не отправляли вовсе (нет получателей / нет токена / период открыт). */
    skipped?: string;
}

/**
 * Собрать ведомость и разослать получателям. НЕ бросает: закрытие периода не должно
 * падать из-за Telegram — вызывающий показывает результат пользователю.
 * trigger — 'close' (автоматом) или 'manual' (кнопкой), пишется в аудит.
 */
export async function sendPayrollToAccounting(params: {
    year: number;
    month: number;
    actor: string | null;
    trigger: 'close' | 'manual';
}): Promise<AccountingDelivery> {
    const { year, month, actor, trigger } = params;
    try {
        // Получатели — НЕ параметр расчёта: берём актуальный список на сегодня, а не
        // на дату периода (иначе июльская ведомость не увидела бы список, заведённый в августе).
        const recipients = await getAccountingRecipients();
        if (!recipients.length) {
            return { ok: false, sent: [], failed: [], skipped: 'Получатели ведомости не настроены (salary_config.accounting_recipients)' };
        }
        if (!botToken()) return { ok: false, sent: [], failed: [], skipped: 'Не задан токен Telegram-бота' };

        const book = await buildPayrollWorkbook(year, month);
        if (!book) return { ok: false, sent: [], failed: [], skipped: 'Период не рассчитан' };
        // Открытый период — черновик: цифры ещё поедут, бухгалтерии его слать нельзя.
        if (book.status !== 'closed') {
            return { ok: false, sent: [], failed: [], skipped: 'Период не закрыт' };
        }

        // Тегаем получателей по нику — в группе иначе никто не заметит файл.
        const tags = recipients.map((r) => r.username).filter(Boolean).map((u) => `@${u}`).join(' ');
        const caption = [
            `<b>Расчётная ведомость ЗП ОП — ${book.periodLabel}</b>`,
            `Период закрыт. Менеджеров: ${book.managers}. ФОТ отдела: <b>${rub(book.fot)}</b>.`,
            tags ? `На согласование: ${tags}` : '',
            `${trigger === 'close' ? 'Закрыл период' : 'Отправил'}: ${actor || 'система'}`,
        ].filter(Boolean).join('\n');

        const sent: string[] = [];
        const failed: { name: string; error: string }[] = [];
        for (const r of recipients) {
            try {
                await sendTelegramDocument({
                    chatId: r.chat_id,
                    threadId: r.thread_id,
                    filename: book.filename,
                    file: book.buffer,
                    caption,
                    contentType: XLSX_MIME,
                    token: botToken(),
                });
                sent.push(r.name);
            } catch (e: any) {
                failed.push({ name: r.name, error: e?.message || String(e) });
            }
        }

        const { data: periodRow } = await supabase
            .from('salary_period')
            .select('id')
            .eq('year', year)
            .eq('month', month)
            .maybeSingle();
        await supabase.from('salary_audit_log').insert({
            entity: 'period',
            entity_id: periodRow ? String(periodRow.id) : `${year}-${month}`,
            action: 'send_to_accounting',
            actor,
            old_value: null,
            new_value: { trigger, sent, failed, fot: book.fot, managers: book.managers, filename: book.filename },
        });

        return { ok: sent.length > 0, sent, failed };
    } catch (e: any) {
        return { ok: false, sent: [], failed: [], skipped: e?.message || String(e) };
    }
}
