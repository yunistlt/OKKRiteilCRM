// Сухой прогон маршрутизатора Катерины (router_v2) прямо по почтовому ящику (IMAP, read-only).
// Только чтение + классификация через OpenAI. НИЧЕГО не пишет и не пересылает.
// npx tsx -r dotenv/config scratch/dryrun_routing_imap.ts 5 dotenv_config_path=.env.local
//   первый числовой аргумент — за сколько последних дней брать письма (по умолч. 5)
import { Client } from 'pg';
import { fetchNewEmails } from '@/lib/email/imap';
import { classifyRoute, isReplyThread, isNoReplySender, type EmailRoute } from '@/lib/email/classify';

const DAYS = Number(process.argv.find((a) => /^\d+$/.test(a)) || 5);
const MAX = 80;

const LABEL: Record<string, string> = {
    new_request: 'Новая заявка', accounting: 'Бухгалтерия', logistics: 'Логистика',
    legal: 'Юрист', procurement: 'Снабжение', reply_thread: 'Переписка', noreply: 'Робот', not_request: 'Не заявка',
};

async function loadPrompt(): Promise<string | undefined> {
    try {
        const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
        await c.connect();
        const r = await c.query("SELECT system_prompt FROM ai_prompts WHERE key='email_secretary_classifier' AND is_active=true");
        await c.end();
        return r.rows[0]?.system_prompt;
    } catch { return undefined; }
}

async function main() {
    const prompt = await loadPrompt();
    console.log('Промпт из БД:', prompt ? `да (${prompt.length} симв.)` : 'нет — дефолт из кода');

    console.log(`Читаю хвост ящика по IMAP (последние ${MAX} писем, read-only)...`);
    const res = await fetchNewEmails({ folder: 'INBOX', lastSeenUid: 0, maxBatch: MAX, coldStartTailOnly: true });
    const emails = res.emails;
    console.log(`Писем для прогона: ${emails.length}\n`);

    const counts: Record<string, number> = {};
    const detail: Array<{ route: string; subject: string; from: string; conf: number; why: string }> = [];

    for (const e of emails) {
        let route: EmailRoute | 'reply_thread' | 'noreply';
        let conf = 0, why = '';
        if (isNoReplySender(e.fromEmail)) {
            route = 'noreply'; why = 'noreply-отправитель';
        } else {
            const v = await classifyRoute(
                { fromEmail: e.fromEmail, fromName: e.fromName, subject: e.subject, bodyText: e.bodyText },
                prompt
            );
            conf = v.confidence; why = v.reasoning;
            route = v.route === 'new_request' && isReplyThread(e.subject) ? 'reply_thread' : v.route;
        }
        counts[route] = (counts[route] || 0) + 1;
        console.log(`[${(LABEL[route] || route).padEnd(12)}] ${String(e.subject || '(без темы)').slice(0, 72)}` + (conf ? `  (${conf.toFixed(2)})` : ''));
        if (['accounting', 'logistics', 'legal', 'procurement', 'new_request'].includes(route)) {
            detail.push({ route, subject: e.subject || '(без темы)', from: e.fromEmail || '', conf, why });
        }
    }

    console.log('\n===== СВОДКА ПО МАРШРУТАМ =====');
    for (const k of ['new_request', 'accounting', 'logistics', 'legal', 'procurement', 'reply_thread', 'noreply', 'not_request']) {
        if (counts[k]) console.log(`  ${(LABEL[k] || k).padEnd(14)} ${counts[k]}`);
    }

    console.log('\n===== ЗАЯВКИ И ПЕРЕСЫЛКИ В ОТДЕЛЫ (детально) =====');
    for (const d of detail) console.log(`• [${LABEL[d.route]}] ${d.subject.slice(0, 60)}\n    от ${d.from} — ${d.why}`);
}
main().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });
