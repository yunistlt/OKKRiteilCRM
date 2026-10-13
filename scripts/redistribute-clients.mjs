/**
 * Раздача клиентов уволенных (и логиста Кати) между тремя менеджерами ОП.
 *
 * Решение владельца 13.10.2026: клиенты уволенных, клиенты без владельца и
 * клиенты, висящие на Кате (она логист, клиентов у неё быть не должно),
 * делятся ПОРОВНУ между Ириной Гордеевой, Еленой Парфеновой и Евгенией
 * Матвеевой. Клиент, у которого уже есть заказы у кого-то из троих, уходит
 * именно ему — постоянный клиент не должен достаться чужому менеджеру
 * (закон «ни одного заказа без активного менеджера»).
 *
 *   node --env-file=.env.local scripts/redistribute-clients.mjs            # только показать
 *   node --env-file=.env.local scripts/redistribute-clients.mjs --apply    # записать
 *
 * Заказы: переносим ТОЛЬКО те, что в рабочих статусах (status_settings.is_working) —
 * у них нет живого хозяина. Закрытую историю не трогаем сознательно: по ней
 * считаны зарплаты закрытых периодов, переписывать их нельзя.
 */
import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
}

// Кому раздаём. Имена — только для вывода, решает id.
const TARGETS = [
    { id: 249, name: 'Гордеева Ирина' },
    { id: 10, name: 'Парфенова Елена' },
    { id: 98, name: 'Матвеева Евгения' },
];
// Карточки Кати Симоновой: 11 — старая с клиентами, 287 — текущая (логист).
const LOGIST_IDS = [11, 287];

const apply = process.argv.includes('--apply');
const db = new Client({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
});

/** Условие «у клиента нет живого хозяина»: ничей, карточки менеджера нет, уволен или это Катя. */
const NO_LIVE_OWNER = `(
    c.manager_id is null
    or m.id is null
    or m.active = false
    or c.manager_id = any($1::text[])
)`;

async function main() {
    await db.connect();
    const logistText = LOGIST_IDS.map(String);

    // 1. Кандидаты: живые карточки клиентов без живого хозяина.
    const { rows: candidates } = await db.query(
        `select c.id::text id,
                coalesce(m.last_name, case when c.manager_id is null then 'без владельца' else 'нет карточки менеджера' end) prev
         from clients c
         left join managers m on m.id::text = c.manager_id
         where c.merged_into is null and ${NO_LIVE_OWNER}
         order by c.id`,
        [logistText],
    );

    // 2. У кого из троих уже есть заказы этого клиента (клиент берётся из orders.customer->>'id').
    const { rows: history } = await db.query(
        `select o.customer->>'id' client_id, o.manager_id, count(*)::int orders, max(o.created_at) last_at
         from orders o
         where o.customer->>'id' is not null and o.manager_id = any($1::bigint[])
         group by 1, 2`,
        [TARGETS.map((t) => t.id)],
    );
    const ownerByHistory = new Map();
    for (const row of history) {
        const best = ownerByHistory.get(row.client_id);
        const better = !best
            || row.orders > best.orders
            || (row.orders === best.orders && row.last_at > best.last_at);
        if (better) ownerByHistory.set(row.client_id, row);
    }

    // 3. Текущее число клиентов у троих — выравниваем ИТОГ, а не порцию раздачи.
    const { rows: current } = await db.query(
        `select c.manager_id, count(*)::int n
         from clients c
         where c.merged_into is null and c.manager_id = any($1::text[])
         group by 1`,
        [TARGETS.map((t) => String(t.id))],
    );
    const total = new Map(TARGETS.map((t) => [t.id, 0]));
    for (const row of current) total.set(Number(row.manager_id), row.n);
    const before = new Map(total);

    // 4. Назначение в два прохода: сначала ВСЕ «свои по заказам», и только потом
    // остаток поровну. Иначе ранние «свои» перекосят итог, а выровнять его
    // поздними уже нечем.
    const plan = new Map(TARGETS.map((t) => [t.id, { history: [], even: [] }]));
    const prevCounts = new Map();
    const rest = [];
    for (const client of candidates) {
        prevCounts.set(client.prev, (prevCounts.get(client.prev) ?? 0) + 1);
        const known = ownerByHistory.get(client.id);
        if (known) {
            const to = Number(known.manager_id);
            plan.get(to).history.push(client.id);
            total.set(to, total.get(to) + 1);
        } else {
            rest.push(client.id);
        }
    }
    for (const id of rest) {
        const to = [...total.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
        plan.get(to).even.push(id);
        total.set(to, total.get(to) + 1);
    }

    // 5. Отчёт.
    console.log(`Кандидатов к раздаче: ${candidates.length}`);
    console.table([...prevCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([prev, n]) => ({ 'был за кем': prev, клиентов: n })));
    console.table(TARGETS.map((t) => {
        const p = plan.get(t.id);
        return {
            менеджер: t.name,
            было: before.get(t.id),
            'по своим заказам': p.history.length,
            поровну: p.even.length,
            станет: total.get(t.id),
        };
    }));

    if (!apply) {
        console.log('\nПоказ без записи. Чтобы записать — тот же запуск с --apply.');
        await db.end();
        return;
    }

    // 6. Запись: владелец карточки + заказы в рабочих статусах того же клиента.
    await db.query('begin');
    try {
        let movedClients = 0;
        let movedOrders = 0;
        for (const target of TARGETS) {
            const ids = [...plan.get(target.id).history, ...plan.get(target.id).even];
            if (!ids.length) continue;

            const res = await db.query(
                'update clients set manager_id = $1, updated_at = now() where id = any($2::bigint[])',
                [String(target.id), ids],
            );
            movedClients += res.rowCount;

            // Заказы без живого хозяина — только рабочие статусы (закрытую историю не трогаем).
            const ord = await db.query(
                `update orders o set manager_id = $1
                 from status_settings ss
                 where ss.code = o.status and ss.is_working
                   and o.customer->>'id' = any($2::text[])
                   and (o.manager_id is null
                        or o.manager_id = any($3::bigint[])
                        or not exists (select 1 from managers m where m.id = o.manager_id and m.active))`,
                [target.id, ids, LOGIST_IDS],
            );
            movedOrders += ord.rowCount;
        }
        // Добор: рабочий заказ без живого менеджера, чей клиент уже принадлежит
        // активному человеку, едет к хозяину клиента. Такие заказы остаются,
        // когда карточка клиента была за активным менеджером, а заказ — за уволенным.
        const tail = await db.query(
            `update orders o set manager_id = owner.id
             from status_settings ss, clients c, managers owner
             where ss.code = o.status and ss.is_working
               and c.id::text = o.customer->>'id' and c.merged_into is null
               and owner.id::text = c.manager_id and owner.active
               and (o.manager_id is null
                    or o.manager_id = any($1::bigint[])
                    or not exists (select 1 from managers m where m.id = o.manager_id and m.active))`,
            [LOGIST_IDS],
        );
        movedOrders += tail.rowCount;

        await db.query('commit');
        console.log(`\nЗаписано: клиентов ${movedClients}, заказов в рабочих статусах ${movedOrders}.`);
    } catch (e) {
        await db.query('rollback');
        throw e;
    }
    await db.end();
}

main().catch(async (e) => {
    console.error('Ошибка:', e.message);
    try { await db.end(); } catch { /* уже закрыт */ }
    process.exit(1);
});
