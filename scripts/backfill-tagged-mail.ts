/**
 * Перенести старую переписку в заказы руками, не дожидаясь ночного крона.
 *
 * Тот же код, что у `/api/cron/email-tagged-backfill`: письма ящика с тегом
 * темы `[#N/<номер>]` за последние 18 месяцев ложатся в наши таблицы и
 * цепляются к заказу. Гоняет проход за проходом, пока письма не кончатся.
 *
 * Запуск (нужны IMAP и ключ к базе, то есть прод-окружение):
 *   npx tsx scripts/backfill-tagged-mail.ts              — один проход
 *   npx tsx scripts/backfill-tagged-mail.ts --all        — до конца
 *   … --batch=50                                        — размер пачки
 *
 * У базы слабый диск (ЗАКОН 16.10.2026): в рабочее время `--all` не гонять.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
    const all = process.argv.includes('--all');
    const batch = Number(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? 100);

    const { backfillTaggedMail } = await import('../lib/email/tagged-backfill');

    let passes = 0;
    for (;;) {
        const result = await backfillTaggedMail(batch);
        passes += 1;
        console.log(
            `проход ${passes}: прочитано ${result.read}, входящих ${result.addedIncoming},`
            + ` отправленных ${result.addedOutgoing}, роботных пропущено ${result.robots},`
            + ` пачек ${result.passes}, осталось просмотреть ${result.left}`,
        );

        if (!result.ok) {
            console.error('остановились:', result.error);
            process.exit(1);
        }
        if (!all || result.left === 0 || result.read === 0) break;
    }
}

void main();
