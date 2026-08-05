import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { buildPayrollWorkbook } from '@/lib/salary/export';
import { getAccountingRecipients } from '@/lib/salary/config';
import { sendTelegramDocument } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Ведомость шлём от бота уведомлений (@okkzmk_bot) — у него уже есть личные чаты
// с сотрудниками; фолбэк — бот Игоря.
function botToken(): string | undefined {
    return process.env.TELEGRAM_SALARY_BOT_TOKEN
        || process.env.TELEGRAM_PAYMENTS_BOT_TOKEN
        || process.env.TELEGRAM_BOT_TOKEN;
}

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

// POST /api/salary/send-to-accounting  body: { year, month }
// Отправляет расчётную ведомость закрытого периода в Telegram бухгалтерии.
export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        const { year, month } = await req.json();
        if (!year || !month) return NextResponse.json({ error: 'Нужны year и month' }, { status: 400 });
        const actor = session?.user?.email ?? null;

        // Получатели — НЕ параметр расчёта: берём актуальный список на сегодня, а не
        // на дату периода (иначе июльская ведомость не увидела бы список, заведённый в августе).
        const recipients = await getAccountingRecipients();
        if (!recipients.length) {
            return NextResponse.json(
                { error: 'Получатели ведомости не настроены (salary_config.accounting_recipients). Бухгалтер должен один раз написать боту, чтобы у него появился chat_id.' },
                { status: 400 },
            );
        }
        if (!botToken()) return NextResponse.json({ error: 'Не задан токен Telegram-бота' }, { status: 500 });

        const book = await buildPayrollWorkbook(Number(year), Number(month));
        if (!book) return NextResponse.json({ error: 'Период не рассчитан' }, { status: 404 });
        // Открытый период — черновик: цифры ещё поедут, бухгалтерии его слать нельзя.
        if (book.status !== 'closed') {
            return NextResponse.json({ error: 'Период не закрыт — сначала закройте период' }, { status: 400 });
        }

        const caption = [
            `<b>Расчётная ведомость ЗП ОП — ${book.periodLabel}</b>`,
            `Период закрыт. Менеджеров: ${book.managers}. ФОТ отдела: <b>${rub(book.fot)}</b>.`,
            `Отправил: ${actor || 'система'}`,
        ].join('\n');

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
            .eq('year', Number(year))
            .eq('month', Number(month))
            .maybeSingle();
        await supabase.from('salary_audit_log').insert({
            entity: 'period',
            entity_id: periodRow ? String(periodRow.id) : `${year}-${month}`,
            action: 'send_to_accounting',
            actor,
            old_value: null,
            new_value: { sent, failed, fot: book.fot, managers: book.managers, filename: book.filename },
        });

        if (!sent.length) {
            return NextResponse.json({ error: `Не отправлено: ${failed.map((f) => `${f.name} — ${f.error}`).join('; ')}` }, { status: 502 });
        }
        return NextResponse.json({ ok: true, sent, failed });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
