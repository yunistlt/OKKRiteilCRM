// Сухой прогон: классификация + НАЗНАЧЕНИЕ менеджера.
// Правило: известный email -> менеджер из истории (если он в пуле из 3); иначе по нагрузке.
// npx tsx -r dotenv/config scratch/dryrun_assign.ts dotenv_config_path=.env.local
import { fetchEmailsSince } from '@/lib/email/imap';
import { classifyNewRequest, isReplyThread, isNoReplySender } from '@/lib/email/classify';
import { Client } from 'pg';

const DAYS = 4;
const POOL: Record<number, string> = { 98: 'Матвеева', 10: 'Парфёнова', 249: 'Гордеева' };
const POOL_IDS = Object.keys(POOL).map(Number);
const norm = (e?: string | null) => (e || '').trim().toLowerCase();

async function main() {
    const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
    await c.connect();

    // email -> менеджер последнего заказа (вся история)
    const hist = await c.query(`
        select distinct on (email) email, manager_id from (
            select coalesce(raw_payload->'contact'->>'email', raw_payload->>'email', raw_payload->'customer'->>'email') email,
                   manager_id, created_at
            from orders where manager_id is not null
        ) t where email is not null and email <> '' order by email, created_at desc`);
    const ownerByEmail = new Map<string, number>();
    for (const r of hist.rows) ownerByEmail.set(norm(r.email), Number(r.manager_id));

    // стартовая нагрузка пула = заказы за 30 дней
    const ld = await c.query(`select manager_id, count(*)::int n from orders
        where created_at >= now()-interval '30 days' and manager_id = any($1) group by manager_id`, [POOL_IDS]);
    const load: Record<number, number> = { 98: 0, 10: 0, 249: 0 };
    for (const r of ld.rows) load[Number(r.manager_id)] = r.n;
    await c.end();
    console.log('Стартовая нагрузка (заказы/30дн):', POOL_IDS.map(id => `${POOL[id]}=${load[id]}`).join(', '), '\n');

    const emails = await fetchEmailsSince(new Date(Date.now() - DAYS * 864e5));
    const leastLoaded = () => POOL_IDS.reduce((a, b) => (load[a] <= load[b] ? a : b));

    let byHistory = 0, byLoad = 0;
    const assignedCount: Record<number, number> = { 98: 0, 10: 0, 249: 0 };
    const lines: string[] = [];

    for (const e of emails) {
        if (isReplyThread(e.subject)) continue;
        if (isNoReplySender(e.fromEmail)) continue;
        const v = await classifyNewRequest({ fromEmail: e.fromEmail, fromName: e.fromName, subject: e.subject, bodyText: e.bodyText });
        if (!v.isNewRequest) continue;

        const sender = norm(e.fromEmail);
        const owner = ownerByEmail.get(sender);
        let mgr: number, how: string;
        if (owner && POOL_IDS.includes(owner)) {
            mgr = owner; how = `история (${POOL[owner]})`; byHistory++;
        } else if (owner) {
            mgr = leastLoaded(); how = `по нагрузке (история=вне пула, mgr ${owner})`; byLoad++;
        } else {
            mgr = leastLoaded(); how = 'по нагрузке (новый клиент)'; byLoad++;
        }
        load[mgr]++; assignedCount[mgr]++;
        lines.push(`  ${POOL[mgr]}  ←  ${e.fromEmail}  «${e.subject}»  [${how}]`);
    }

    console.log(lines.join('\n'));
    console.log(`\n${'='.repeat(80)}\nИТОГО заявок: ${byHistory + byLoad}`);
    console.log(`  по истории клиента: ${byHistory}`);
    console.log(`  по нагрузке:        ${byLoad}`);
    console.log('\nРаспределение по менеджерам:', POOL_IDS.map(id => `${POOL[id]}=${assignedCount[id]}`).join(', '));
    console.log('Итоговая нагрузка (старт+новые):', POOL_IDS.map(id => `${POOL[id]}=${load[id]}`).join(', '));
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
