// Финальный сухой прогон воркера «Новые заявки».
// Re/CRM-тег -> переписка (пропуск). noreply -> спам (пропуск). Иначе AI: заявка / не заявка.
// Дедупа против существующих заказов НЕТ (решение владельца): нет Re -> новая заявка.
// npx tsx -r dotenv/config scratch/analyze_emails.ts dotenv_config_path=.env.local
import { fetchEmailsSince } from '@/lib/email/imap';
import { classifyNewRequest, isReplyThread, isNoReplySender } from '@/lib/email/classify';

const DAYS = 4;

async function main() {
    const since = new Date(Date.now() - DAYS * 864e5);
    console.log(`Тяну письма с ${since.toISOString()} (последние ${DAYS} дня)...\n`);
    const emails = await fetchEmailsSince(since);
    console.log(`Получено писем: ${emails.length}\n${'='.repeat(80)}`);

    let skippedRe = 0, noreply = 0, newReq = 0, ignored = 0;
    const orders: string[] = [];

    for (const e of emails) {
        if (isReplyThread(e.subject)) { skippedRe++; continue; }
        if (isNoReplySender(e.fromEmail)) { noreply++; continue; }
        const v = await classifyNewRequest({ fromEmail: e.fromEmail, fromName: e.fromName, subject: e.subject, bodyText: e.bodyText });
        if (v.isNewRequest) {
            newReq++;
            orders.push(`  ✅ [${(v.confidence * 100).toFixed(0)}%] ${e.fromName || e.fromEmail} <${e.fromEmail}> — ${e.subject}`);
        } else ignored++;
    }

    console.log('\n🆕 БУДУТ СОЗДАНЫ ЗАКАЗЫ (новые заявки):\n');
    console.log(orders.join('\n'));
    console.log(`\n${'='.repeat(80)}\nИТОГО за ${DAYS} дня (всего ${emails.length}):`);
    console.log(`  ⏭  Переписка (Re/CRM-тег):        ${skippedRe}`);
    console.log(`  🤖 noreply-робот → спам:           ${noreply}`);
    console.log(`  🗑  Не заявка (AI):                 ${ignored}`);
    console.log(`  🆕 Новых заявок → создать заказ:    ${newReq}`);
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
