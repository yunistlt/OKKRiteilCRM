/**
 * Разовая сверка всей базы заказов с RetailCRM.
 *
 * То же, что делает крон crm-reconcile-deleted, но напрямую по DATABASE_URL:
 * локально service-role ключа Supabase нет. Нужна, чтобы не ждать сутки,
 * пока крон обойдёт базу по кругу.
 */
import postgres from 'postgres';
import fs from 'fs';

const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const sql = postgres(env.DATABASE_URL || env.POSTGRES_URL, { ssl: 'require' });
const base = (env.RETAILCRM_URL || env.RETAILCRM_API_URL).replace(/\/$/, '');
const key = env.RETAILCRM_API_KEY;

const rows = await sql`select order_id, crm_deleted_at from orders order by crm_checked_at nulls first`;
console.log('к проверке:', rows.length);

let deleted = 0, restored = 0, done = 0;
for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const u = new URL(base + '/api/v5/orders');
    u.searchParams.set('apiKey', key);
    u.searchParams.set('limit', '100');
    chunk.forEach((r) => u.searchParams.append('filter[ids][]', String(r.order_id)));
    const res = await fetch(u);
    if (!res.ok) { console.error('CRM', res.status); await new Promise((r) => setTimeout(r, 2000)); i -= 50; continue; }
    const j = await res.json();
    const alive = new Set((j.orders || []).map((o) => Number(o.id)));

    const gone = chunk.filter((r) => !alive.has(Number(r.order_id)) && !r.crm_deleted_at).map((r) => r.order_id);
    const back = chunk.filter((r) => alive.has(Number(r.order_id)) && r.crm_deleted_at).map((r) => r.order_id);
    if (gone.length) await sql`update orders set crm_deleted_at = now(), crm_checked_at = now() where order_id in ${sql(gone)}`;
    if (back.length) await sql`update orders set crm_deleted_at = null, crm_checked_at = now() where order_id in ${sql(back)}`;
    // Отметку ставим всем в пачке: без неё живые заказы остаются с NULL и очередь
    // крутится по одному и тому же кругу.
    await sql`update orders set crm_checked_at = now() where order_id in ${sql(chunk.map((r) => r.order_id))}`;

    deleted += gone.length; restored += back.length; done += chunk.length;
    if (done % 1000 < 50) console.log(done, '/', rows.length, 'удалено', deleted, 'вернулось', restored);
    await new Promise((r) => setTimeout(r, 120));
}
console.log('итог: проверено', done, 'помечено удалёнными', deleted, 'вернулось', restored);
await sql.end();
