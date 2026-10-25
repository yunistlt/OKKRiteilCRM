/**
 * Тестовые люди и заказы на стенде.
 *
 * Стенд получает структуру и справочники с прода (`staging-seed.ts`), но без
 * данных: открыть нечего, войти некем. Здесь заводим трёх выдуманных
 * сотрудников и десяток выдуманных заказов с клиентами — чтобы проверять
 * экраны и правки до выкатки в прод (решение владельца 22.10.2026).
 *
 * Данные выдуманные намеренно: боевые заказы, клиенты и переписка на стенд не
 * переносятся никогда.
 *
 * Запуск:
 *   npx tsx scripts/staging-demo-data.ts --apply
 */
import { config } from 'dotenv';
import postgres from 'postgres';
import { randomUUID } from 'crypto';

config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

/** Люди стенда: пароль простой, на стенде это не секрет. */
const PEOPLE = [
    { username: 'test-admin', password: 'test-admin', role: 'admin', lastName: 'Тестов', firstName: 'Админ', managerId: null },
    { username: 'test-rop', password: 'test-rop', role: 'rop', lastName: 'Тестова', firstName: 'Руководитель', managerId: null },
    { username: 'test-manager', password: 'test-manager', role: 'manager', lastName: 'Тестова', firstName: 'Менеджер', managerId: null },
];

const COMPANIES = [
    { name: 'ООО «Пример-Пром»', inn: '7700000001' },
    { name: 'ООО «Тестовый Завод»', inn: '7700000002' },
    { name: 'АО «Образец-Логистика»', inn: '7700000003' },
    { name: 'ООО «Демо-Склад»', inn: '7700000004' },
    { name: 'ООО «Пробная Сборка»', inn: '7700000005' },
];

const PRODUCTS = [
    { name: 'Шкаф сушильный ШСО-22М', price: 306700 },
    { name: 'Стеллаж металлический СМ-150', price: 48900 },
    { name: 'Шкаф для ЛВЖ ШХЛ-1200', price: 132400 },
    { name: 'Печь муфельная ПМ-400', price: 461400 },
    { name: 'Стол сборочный СС-2000', price: 87300 },
];

async function main() {
    const url = process.env.STAGING_DATABASE_URL;
    if (!url) {
        console.error('Нужен STAGING_DATABASE_URL в .env.local');
        process.exit(1);
    }
    if (!APPLY) {
        console.log('Это показ: будет заведено', PEOPLE.length, 'сотрудников,',
            COMPANIES.length, 'клиентов и', COMPANIES.length * 2, 'заказов. Повторите с --apply.');
        return;
    }

    const sql = postgres(url, { ssl: 'require', max: 1 });

    // 1. Сотрудники. Существующих тестовых переписываем, чужих не трогаем.
    const managers = await sql`select id, first_name, last_name from managers where active is not false order by id limit 3`;
    for (const [index, person] of PEOPLE.entries()) {
        const managerId = (managers[index] as any)?.id ?? null;
        await sql`
            insert into users (id, username, password_hash, role, retail_crm_manager_id, first_name, last_name, email)
            values (${randomUUID()}, ${person.username}, ${person.password}, ${person.role},
                    ${managerId}, ${person.firstName}, ${person.lastName}, ${`${person.username}@example.test`})
            on conflict (username) do update
                set password_hash = excluded.password_hash,
                    role = excluded.role,
                    retail_crm_manager_id = excluded.retail_crm_manager_id
        `;
        console.log(`сотрудник ${person.username} / ${person.password} (${person.role}), менеджер ${managerId ?? '—'}`);
    }

    // 2. Клиенты и заказы. Номера свои, в диапазоне наших заказов.
    const statuses = await sql`select code from statuses limit 6`;
    const codes = (statuses as any[]).map((s) => s.code);
    const managerIds = (managers as any[]).map((m) => Number(m.id));

    let created = 0;
    for (const [index, company] of COMPANIES.entries()) {
        const clientId = 990000000 + index;
        await sql`
            insert into clients (id, company_name, inn, email, is_corporate, manager_id, source)
            values (${clientId}, ${company.name}, ${company.inn},
                    ${`client${index}@example.test`}, true, ${managerIds[index % managerIds.length] ?? null}, 'staging-demo')
            on conflict (id) do nothing
        `;

        for (let n = 0; n < 2; n += 1) {
            const seq = index * 2 + n;
            const orderId = 990000100 + seq;
            const product = PRODUCTS[seq % PRODUCTS.length];
            const total = product.price * (1 + (seq % 3));
            const payload = {
                id: orderId,
                number: String(990100 + seq),
                status: codes[seq % codes.length] ?? 'novyi-1',
                customer: { id: clientId, type: 'customer_corporate', nickName: company.name },
                contragent: { legalName: company.name, INN: company.inn },
                firstName: 'Контакт',
                lastName: 'Тестовый',
                email: `client${index}@example.test`,
                phone: `+7900000${String(seq).padStart(4, '0')}`,
                managerId: managerIds[seq % managerIds.length] ?? null,
                customerComment: 'Выдуманный заказ стенда — для проверки экранов.',
                customFields: { typ_castomer: 'trebuetsya-utochnit', srok_izgot: 30 },
                items: [{ id: orderId * 10, offer: { name: product.name }, initialPrice: product.price, quantity: 1 + (seq % 3) }],
                totalSumm: total,
                createdAt: new Date(Date.now() - seq * 86400000).toISOString().slice(0, 19).replace('T', ' '),
            };

            await sql`
                insert into orders (id, order_id, number, status, totalsumm, manager_id, customer, raw_payload, "createdAt", created_at, is_own)
                values (${orderId}, ${orderId}, ${payload.number}, ${payload.status}, ${total},
                        ${payload.managerId}, ${sql.json(payload.customer)}, ${sql.json(payload)},
                        ${payload.createdAt}, now(), true)
                on conflict (id) do nothing
            `.catch((e: any) => console.warn(`заказ ${payload.number}: ${e.message}`));
            created += 1;
        }
    }

    console.log(`клиентов ${COMPANIES.length}, заказов ${created}`);
    await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
