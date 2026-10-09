/**
 * Слияние карточек клиента с одинаковым ИНН.
 *
 * Закон владельца 09.10.2026: одно юрлицо — одна карточка. Ссылаемся на
 * `clients.id` (он есть у всех, включая иностранцев без ИНН), а ИНН делаем
 * уникальным там, где он заполнен.
 *
 * Откуда дубли: автоприём заводил свою карточку, когда ИНН в письме ещё не
 * был известен, а позже ИНН проставлялся из реквизитов — и совпадал с давней
 * карточкой RetailCRM. Поэтому в паре почти всегда «старая из CRM» и «наша».
 *
 * Главной оставляем ту, у которой больше заказов (при равенстве — с меньшим
 * id, то есть более давнюю). Заказы, письма и реквизиты переносим на неё,
 * вторую помечаем слитой: удалять карточку нельзя, на неё ссылаются старые
 * документы.
 *
 * Запуск: node scripts/merge-client-duplicates-by-inn.mjs [--apply]
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const env = readFileSync('.env.local', 'utf8');
const url = (/^DATABASE_URL=(.*)$/m.exec(env)?.[1] ?? process.env.DATABASE_URL ?? '')
    .trim().replace(/^"|"$/g, '');
const sql = postgres(url, { ssl: 'require', max: 1 });

const rows = await sql`
    SELECT c.inn, c.id, c.company_name, c.orders_count, c.created_at,
           (SELECT count(*)::int FROM public.orders o WHERE o.customer->>'id' = c.id::text) AS orders_here
      FROM public.clients c
      JOIN (
        SELECT inn FROM public.clients
         WHERE inn IS NOT NULL AND inn <> '' AND merged_into IS NULL
         GROUP BY inn HAVING count(*) > 1
      ) d ON d.inn = c.inn
     WHERE c.merged_into IS NULL
     ORDER BY c.inn, c.id`;

const groups = new Map();
for (const row of rows) {
    const list = groups.get(row.inn) ?? [];
    list.push(row);
    groups.set(row.inn, list);
}

let merged = 0;
let movedOrders = 0;

for (const [inn, list] of groups) {
    // Главная карточка: больше всего заказов, при равенстве — самая давняя.
    const sorted = [...list].sort((a, b) =>
        (b.orders_here - a.orders_here) || (Number(a.id) - Number(b.id)));
    const [main, ...rest] = sorted;

    console.log(`\nИНН ${inn} → главная id=${main.id} «${main.company_name}» (заказов ${main.orders_here})`);

    for (const dup of rest) {
        console.log(`   сливаем id=${dup.id} «${dup.company_name}» (заказов ${dup.orders_here})`);
        if (!APPLY) continue;

        // Заказы переводим на главную карточку.
        // Тип указываем явно: без него Postgres не знает, чем считать параметр
        // внутри to_jsonb, и запрос падает на несогласованности типов.
        const moved = await sql`
            UPDATE public.orders
               SET customer = jsonb_set(coalesce(customer, '{}'::jsonb), '{id}', to_jsonb(${Number(main.id)}::bigint)),
                   raw_payload = jsonb_set(coalesce(raw_payload, '{}'::jsonb), '{customer,id}', to_jsonb(${Number(main.id)}::bigint))
             WHERE customer->>'id' = ${String(dup.id)}
            RETURNING number`;
        movedOrders += moved.length;

        // Реквизиты, которых у главной нет, забираем из дубля: их вносил человек.
        await sql`
            UPDATE public.clients m
               SET inn = coalesce(nullif(m.inn, ''), d.inn),
                   kpp = coalesce(nullif(m.kpp, ''), d.kpp),
                   "legalName" = coalesce(nullif(m."legalName", ''), d."legalName"),
                   "legalAddress" = coalesce(nullif(m."legalAddress", ''), d."legalAddress"),
                   bank = coalesce(nullif(m.bank, ''), d.bank),
                   "bankAccount" = coalesce(nullif(m."bankAccount", ''), d."bankAccount"),
                   "BIK" = coalesce(nullif(m."BIK", ''), d."BIK"),
                   "corrAccount" = coalesce(nullif(m."corrAccount", ''), d."corrAccount"),
                   email = coalesce(nullif(m.email, ''), d.email),
                   contact_email = coalesce(nullif(m.contact_email, ''), d.contact_email),
                   phones = CASE
                       WHEN coalesce(array_length(m.phones, 1), 0) = 0 THEN d.phones
                       ELSE m.phones
                   END,
                   updated_at = now()
              FROM public.clients d
             WHERE m.id = ${Number(main.id)} AND d.id = ${Number(dup.id)}`;

        // Карточку не удаляем: на неё ссылаются старые документы и выгрузки.
        await sql`
            UPDATE public.clients
               SET merged_into = ${Number(main.id)}, inn = NULL, updated_at = now()
             WHERE id = ${Number(dup.id)}`;

        merged += 1;
    }
}

console.log(`\nгрупп: ${groups.size}, слито карточек: ${merged}, перенесено заказов: ${movedOrders}`);
if (!APPLY) console.log('Это пробный прогон. Повторите с --apply.');

await sql.end();
