// Разовая отправка ведомости за период из локали (на проде это делает кнопка).
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
    const { buildPayrollWorkbook } = await import('@/lib/salary/export');
    const { getAccountingRecipients } = await import('@/lib/salary/config');
    const { sendTelegramDocument } = await import('@/lib/telegram');

    const year = Number(process.argv[2]);
    const month = Number(process.argv[3]);
    const book = await buildPayrollWorkbook(year, month);
    if (!book) throw new Error('Период не рассчитан');
    console.log('Период:', book.periodLabel, '| статус:', book.status, '| менеджеров:', book.managers, '| ФОТ:', Math.round(book.fot).toLocaleString('ru-RU'));
    if (book.status !== 'closed') throw new Error('Период не закрыт');

    const caption = [
        `<b>Расчётная ведомость ЗП ОП — ${book.periodLabel}</b>`,
        `Период закрыт. Менеджеров: ${book.managers}. ФОТ отдела: <b>${Math.round(book.fot).toLocaleString('ru-RU')} ₽</b>.`,
    ].join('\n');

    for (const r of await getAccountingRecipients()) {
        await sendTelegramDocument({
            chatId: r.chat_id,
            filename: book.filename,
            file: book.buffer,
            caption,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            token: process.env.TELEGRAM_PAYMENTS_BOT_TOKEN,
        });
        console.log('Отправлено:', r.name);
    }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
