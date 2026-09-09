/**
 * Приёмка инструментов Тамары по боевой базе ЦехУспеха.
 *
 *   npx tsx scripts/shtab_tseh_smoke.ts
 *
 * Первое, что запускается, когда у Андрея появится учётка `tamara_ro` и в
 * .env.local ляжет SHTAB_DB_TSEH_URL. Проверяет по порядку: соединение,
 * кодировку (русские статусы, иначе запросы молча вернут пусто), право EXECUTE
 * на SalaryOrder и CostOrderExt (без него не считается прибыль) и каждый
 * инструмент. Ничего не пишет — ни в базу цеха, ни в свою.
 *
 * Заполненность времени операций печатается первой: от неё зависит, можно ли
 * вообще считать из ЦехУспеха такт, узкое место и пролёживание.
 */
import { config } from 'dotenv';
import { closeExternal, externalDbConfigured, queryExternal } from '@/lib/shtab/external/client';
import { executeTsehTool } from '@/lib/shtab/tseh-tools';

config({ path: '.env.local' });

async function main() {
    if (!externalDbConfigured('tseh')) {
        console.error('Нет SHTAB_DB_TSEH_URL в .env.local — проверять нечего.');
        process.exit(1);
    }

    console.log('— соединение и кодировка');
    const statuses = await queryExternal<any>(
        'tseh',
        'SELECT NameStatus FROM StatusesOrders WHERE NameStatus IS NOT NULL LIMIT 5',
    );
    const names = statuses.map((r) => r.NameStatus);
    console.log('  статусы:', names.join(', ') || '(пусто)');
    if (names.some((n: string) => /\?/.test(String(n)))) {
        console.error('  ОШИБКА: русские значения приходят как «?» — кодировка не utf8mb4, числам верить нельзя.');
        process.exit(1);
    }

    console.log('— право EXECUTE на функции ЦехУспеха');
    try {
        await queryExternal('tseh', 'SELECT SalaryOrder(0) AS s, CostOrderExt(0) AS c');
        console.log('  есть');
    } catch (e: any) {
        console.error('  НЕТ:', e.message, '— прибыль и маржа считаться не будут');
    }

    const checks: Array<[string, any]> = [
        ['tseh_ops_coverage', { months: 12 }],
        ['tseh_balance_history', { months: 2, types: [1, 16] }],
        ['tseh_revenue_history', { months: 6 }],
        ['tseh_profit_history', { months: 3 }],
        ['tseh_debt', {}],
        ['tseh_customers', { months: 12 }],
    ];

    for (const [name, args] of checks) {
        const started = Date.now();
        const res: any = await executeTsehTool(name, args);
        const took = `${Math.round((Date.now() - started) / 100) / 10}с`;
        if (res.available === false) {
            console.error(`— ${name} (${took}): ОТКАЗ — ${res.reason}`);
            continue;
        }
        // Клиентов и дни не печатаем целиком: это данные завода, им место в чате
        // владельца, а не в логе терминала.
        const short =
            name === 'tseh_customers'
                ? { customers: res.customers.length, top: res.customers[0]?.name }
                : name === 'tseh_balance_history'
                  ? { days: res.days.length, last: res.days[res.days.length - 1] }
                  : res;
        console.log(`— ${name} (${took}):`, JSON.stringify(short, null, 2));
    }

    await closeExternal();
}

main().catch(async (e) => {
    console.error(e);
    await closeExternal();
    process.exit(1);
});
