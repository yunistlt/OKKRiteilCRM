// Сухой прогон воркера «Новые заявки» + сверка с уже существующими заказами в RetailCRM (наш синк).
// Заказы НЕ создаём. Для каждой заявки ищем заказ от того же email клиента.
// npx tsx -r dotenv/config scratch/dryrun_with_dedup.ts dotenv_config_path=.env.local
import { fetchEmailsSince } from '@/lib/email/imap';
import { classifyNewRequest, isReplyThread } from '@/lib/email/classify';
import { Client } from 'pg';

const DAYS = 4;
const RECENT_ORDER_WINDOW_DAYS = 45;

function norm(e?: string | null) { return (e || '').trim().toLowerCase(); }

async function main() {
    // 1) карта email -> заказы (за последние 45 дней)
    const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
    await c.connect();
    const since45 = new Date(Date.now() - RECENT_ORDER_WINDOW_DAYS * 864e5).toISOString();
    const ord = await c.query(
        `select number, status, created_at,
                coalesce(raw_payload->'contact'->>'email', raw_payload->>'email', raw_payload->'customer'->>'email') as email
         from orders where created_at >= $1`, [since45]);
    const byEmail = new Map<string, Array<any>>();
    for (const r of ord.rows) {
        const e = norm(r.email);
        if (!e) continue;
        if (!byEmail.has(e)) byEmail.set(e, []);
        byEmail.get(e)!.push(r);
    }
    await c.end();
    console.log(`Заказов за ${RECENT_ORDER_WINDOW_DAYS} дн.: ${ord.rows.length}, уникальных email: ${byEmail.size}\n`);

    // 2) письма за 4 дня -> пайплайн
    const since = new Date(Date.now() - DAYS * 864e5);
    const emails = await fetchEmailsSince(since);
    console.log(`Писем за ${DAYS} дн.: ${emails.length}\n${'='.repeat(80)}`);

    let dupCount = 0, freshCount = 0, skipped = 0, ignored = 0;
    const dups: string[] = [], fresh: string[] = [];

    for (const e of emails) {
        if (isReplyThread(e.subject)) { skipped++; continue; }
        const v = await classifyNewRequest({ fromEmail: e.fromEmail, fromName: e.fromName, subject: e.subject, bodyText: e.bodyText });
        if (!v.isNewRequest) { ignored++; continue; }

        const sender = norm(e.fromEmail);
        const existing = byEmail.get(sender) || [];
        if (existing.length > 0) {
            dupCount++;
            const latest = existing.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
            dups.push(`  ⚠️  ${e.fromEmail} — "${e.subject}"\n        уже есть заказ №${latest.number} (${latest.status}, ${new Date(latest.created_at).toLocaleDateString('ru-RU')}); всего заказов от этого email: ${existing.length}`);
        } else {
            freshCount++;
            fresh.push(`  ✅ ${e.fromEmail} — "${e.subject}"`);
        }
    }

    console.log(`\n🔁 ЗАЯВКИ, У КОТОРЫХ УЖЕ ЕСТЬ ЗАКАЗ ОТ ЭТОГО EMAIL (${dupCount}):\n`);
    console.log(dups.join('\n'));
    console.log(`\n🆕 ЗАЯВКИ БЕЗ СУЩЕСТВУЮЩЕГО ЗАКАЗА (${freshCount}):\n`);
    console.log(fresh.join('\n'));

    console.log(`\n${'='.repeat(80)}\nИТОГО за ${DAYS} дня (всего ${emails.length}):`);
    console.log(`  ⏭  Переписка (Re/CRM-тег), пропуск:        ${skipped}`);
    console.log(`  🗑  Не заявка (спам/уведомления/поставщик): ${ignored}`);
    console.log(`  🔁 Заявка, но email уже есть в заказах:     ${dupCount}`);
    console.log(`  🆕 Заявка без существующего заказа:         ${freshCount}`);
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
