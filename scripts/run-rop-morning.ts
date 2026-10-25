/**
 * Разовый запуск утреннего плана отдела продаж — тот же код, что в кроне
 * app/api/cron/rop-morning.
 *
 * Нужен, когда крон Vercel не отработал (16.10.2026 он упал: база без обслуживания
 * не укладывалась в таймаут), а план отделу нужен сегодня, а не завтра.
 *
 * По умолчанию — вхолостую: собрать и показать, ничего не отправляя и не записывая.
 * Боевой запуск с рассылкой в Telegram — только с явным --go.
 *
 *   npx tsx scripts/run-rop-morning.ts          # показать, что получится
 *   npx tsx scripts/run-rop-morning.ts --go     # разослать и записать задачи
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
    const { runMorning } = await import('../lib/sales-rop/service');
    const { localToday } = await import('../lib/sales-rop/local-day');

    const go = process.argv.includes('--go');
    const today = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || localToday();

    console.log(go ? 'БОЕВОЙ запуск' : 'Вхолостую (ничего не отправляется)', '— день', today);

    const result = await runMorning(today, { dryRun: !go });

    const { preview, ...rest } = result as any;
    console.log('--- итог:', JSON.stringify(rest));
    for (const block of (preview ?? []) as string[]) {
        console.log('\n----------------------------------------');
        console.log(block);
    }
}

main().catch((e) => {
    console.error('ОШИБКА:', e?.message || e);
    process.exit(1);
});
