// Сухой прогон маршрутизатора Катерины (router_v2) на реальных недавних письмах.
// Только чтение из БД (pg) + классификация через OpenAI. НИЧЕГО не пишет и не пересылает.
// npx tsx -r dotenv/config scratch/dryrun_routing.ts dotenv_config_path=.env.local
import { Client } from 'pg';
import { classifyRoute, isReplyThread, isNoReplySender, type EmailRoute } from '@/lib/email/classify';

const LIMIT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 60);

const LABEL: Record<string, string> = {
    new_request: 'Новая заявка', accounting: 'Бухгалтерия', logistics: 'Логистика',
    legal: 'Юрист', procurement: 'Снабжение', reply_thread: 'Переписка', noreply: 'Робот', not_request: 'Не заявка',
};

async function main() {
    const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
    await client.connect();

    const promptRow = await client.query("SELECT system_prompt FROM ai_prompts WHERE key='email_secretary_classifier' AND is_active=true");
    const prompt: string | undefined = promptRow.rows[0]?.system_prompt;
    console.log('Промпт из БД:', prompt ? `да (${prompt.length} симв.)` : 'нет — будет дефолт из кода');

    const { rows } = await client.query(
        `SELECT from_email, from_name, subject, body_text, received_at
         FROM incoming_emails
         ORDER BY received_at DESC NULLS LAST
         LIMIT $1`, [LIMIT]
    );
    await client.end();
    console.log(`Писем для прогона: ${rows.length}\n`);

    const counts: Record<string, number> = {};
    const byDept: Array<{ route: string; subject: string; from: string; conf: number; why: string }> = [];

    for (const e of rows) {
        let route: EmailRoute | 'reply_thread' | 'noreply';
        let conf = 0, why = '';
        if (isNoReplySender(e.from_email)) {
            route = 'noreply'; why = 'noreply-отправитель';
        } else {
            const v = await classifyRoute(
                { fromEmail: e.from_email, fromName: e.from_name, subject: e.subject, bodyText: e.body_text },
                prompt
            );
            conf = v.confidence; why = v.reasoning;
            route = v.route === 'new_request' && isReplyThread(e.subject) ? 'reply_thread' : v.route;
        }
        counts[route] = (counts[route] || 0) + 1;
        const line = `[${(LABEL[route] || route).padEnd(12)}] ${String(e.subject || '(без темы)').slice(0, 70)}`;
        console.log(line + (conf ? `  (${conf.toFixed(2)})` : ''));
        if (['accounting', 'logistics', 'legal', 'procurement', 'new_request'].includes(route)) {
            byDept.push({ route, subject: e.subject || '(без темы)', from: e.from_email || '', conf, why });
        }
    }

    console.log('\n===== СВОДКА ПО МАРШРУТАМ =====');
    for (const k of ['new_request', 'accounting', 'logistics', 'legal', 'procurement', 'reply_thread', 'noreply', 'not_request']) {
        if (counts[k]) console.log(`  ${(LABEL[k] || k).padEnd(14)} ${counts[k]}`);
    }

    console.log('\n===== ЗАЯВКИ И ПЕРЕСЫЛКИ В ОТДЕЛЫ (детально) =====');
    for (const d of byDept) {
        console.log(`• [${LABEL[d.route]}] ${d.subject.slice(0, 60)}\n    от ${d.from} — ${d.why}`);
    }
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
