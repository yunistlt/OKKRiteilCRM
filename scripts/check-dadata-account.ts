/**
 * Что за аккаунт Dadata и что ему доступно.
 *
 * Пустые выручка и штат означают одно из трёх: оплата ещё не активировалась,
 * оплачен не тот продукт, или ключ в .env.local не от того аккаунта. Гадать
 * бессмысленно — спрашиваем сам сервис.
 *
 * Баланс и статистика требуют секретный ключ (DADATA_SECRET_KEY), он отдельный
 * от ключа подсказок. Берётся в личном кабинете, в том же разделе с API-ключом.
 *
 * Запуск: npx tsx scripts/check-dadata-account.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API = process.env.DADATA_API_KEY || '';
const SECRET = process.env.DADATA_SECRET_KEY || '';

async function ask(url: string): Promise<{ status: number; body: string }> {
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            Authorization: `Token ${API}`,
            ...(SECRET ? { 'X-Secret': SECRET } : {}),
        },
        signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: (await res.text()).slice(0, 400) };
}

async function main() {
    if (!API) throw new Error('нет DADATA_API_KEY в .env.local');
    console.log('ключ подсказок:', API.slice(0, 6) + '…' + API.slice(-4));
    console.log('секретный ключ:', SECRET ? 'есть' : 'НЕТ — баланс и статистика недоступны');

    const balance = await ask('https://dadata.ru/api/v2/profile/balance');
    console.log('\nбаланс →', balance.status, balance.body);

    const stat = await ask(`https://dadata.ru/api/v2/stat/daily?date=${new Date().toISOString().slice(0, 10)}`);
    console.log('расход за сегодня →', stat.status, stat.body);

    console.log(
        '\n401/403 при наличии секретного ключа — ключи от разных аккаунтов.',
        '\nБаланс есть, но выручка пуста — оплачен продукт, который её не отдаёт.',
    );
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
