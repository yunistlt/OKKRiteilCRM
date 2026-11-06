/**
 * Дописать город в orders.search_text у старых заказов.
 *
 * Город в двух местах: кастом-поле «Город доставки (менеджерам ОП)» и адрес
 * доставки. Берём оба.
 *
 * Миграция 20261106_orders_search_city.sql меняет только триггер — он считает
 * search_text заново при следующей записи заказа. Старые строки так и остаются
 * без адреса, поэтому их надо потрогать: `SET id = id` достаточно, пересчётом
 * занимается триггер.
 *
 * ПОРЦИЯМИ И ВЕЧЕРОМ. У базы слабый диск: массовый UPDATE в рабочее время
 * кладёт отдел (авария 16.10.2026). Берём по 300 заказов, между порциями спим,
 * и только те, у которых адрес есть, а в search_text его ещё нет.
 *
 * Запуск:
 *   node scripts/backfill-orders-search-city.js            # посчитать, сколько строк
 *   node scripts/backfill-orders-search-city.js --apply    # писать
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const APPLY = process.argv.includes('--apply');
const CHUNK = 300;
const PAUSE_MS = 700;

function databaseUrl() {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const match = env.match(/^(?:DATABASE_URL|POSTGRES_URL)=(.+)$/m);
    if (!match) throw new Error('В .env.local нет DATABASE_URL');
    return match[1].trim().replace(/^["']|["']$/g, '');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    const sql = postgres(databaseUrl(), { ssl: 'require', max: 1 });

    /** Заказ с адресом, которого ещё нет в поисковой строке. */
    const pending = () => sql`
        SELECT id
        FROM orders
        WHERE coalesce(
                  raw_payload->'customFields'->>'gorod_dostavki_menedzheram_op',
                  delivery->'address'->>'city',
                  delivery->'address'->>'region',
                  delivery->'address'->>'text',
                  warehouse_address,
                  ''
              ) <> ''
          AND position(
                  lower(coalesce(
                      raw_payload->'customFields'->>'gorod_dostavki_menedzheram_op',
                      delivery->'address'->>'city',
                      delivery->'address'->>'region',
                      delivery->'address'->>'text',
                      warehouse_address
                  )) IN coalesce(search_text, '')
              ) = 0
        ORDER BY id
        LIMIT ${CHUNK}`;

    const [{ count }] = await sql`
        SELECT count(*)::int AS count
        FROM orders
        WHERE coalesce(raw_payload->'customFields'->>'gorod_dostavki_menedzheram_op',
                       delivery->'address'->>'city', delivery->'address'->>'region',
                       delivery->'address'->>'text', warehouse_address, '') <> ''`;
    console.log(`заказов с адресом: ${count.toLocaleString('ru-RU')}`);

    if (!APPLY) {
        const first = await pending();
        console.log(`без адреса в поиске: минимум ${first.length} (показана одна порция)`);
        console.log('это разведка; писать — с ключом --apply, и вечером');
        await sql.end();
        return;
    }

    let done = 0;
    for (;;) {
        const rows = await pending();
        if (!rows.length) break;

        const ids = rows.map((row) => row.id);
        // Триггер orders_fill_search_text пересчитает строку поиска сам.
        await sql`UPDATE orders SET id = id WHERE id = ANY(${sql.array(ids)})`;

        done += ids.length;
        console.log(`${new Date().toLocaleTimeString('ru-RU')} — переписано ${done.toLocaleString('ru-RU')}`);
        await sleep(PAUSE_MS);
    }

    console.log(`готово, строк: ${done.toLocaleString('ru-RU')}`);
    await sql.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
