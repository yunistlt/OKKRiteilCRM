/**
 * Вернуть в очередь копии писем, которые ящик когда-то отказался принять.
 *
 * 12–13.10.2026 Яндекс семь часов не принимал копии в «Отправленные», а задача
 * сдавалась за пятнадцать минут (пять попыток по две). 57 писем клиент получил,
 * а в почтовом ящике их не видно. Тела писем целы в хранилище — копии можно
 * дозаписать задним числом.
 *
 * Дубля не будет: перед записью воркер ищет письмо по Message-ID
 * (`appendCopiesToSent`). ВАЖНО: запускать только после того, как этот код
 * оказался на проде — старый писал в ящик без проверки.
 *
 * Запуск:
 *   npx tsx scripts/requeue-sent-copies.ts            # только показать
 *   npx tsx scripts/requeue-sent-copies.ts --apply    # вернуть в очередь
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

loadEnv({ path: '.env.local' });
loadEnv();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('Нет DATABASE_URL (или POSTGRES_URL) в окружении');
    process.exit(1);
}

const apply = process.argv.includes('--apply');
const sql = postgres(connectionString, { ssl: 'require', max: 1 });

async function main() {
    const dead = await sql`
        select id, payload->>'subject' as subject, payload->>'messageId' as message_id, created_at
        from system_jobs
        where job_type = 'email_sent_append' and status = 'dead_letter'
        order by created_at
    `;

    console.log(`Задач без копии: ${dead.length}`);
    for (const row of dead.slice(0, 10)) {
        console.log(`  ${new Date(row.created_at).toLocaleString('ru-RU')} — ${row.subject ?? 'без темы'}`);
    }
    if (dead.length > 10) console.log(`  … и ещё ${dead.length - 10}`);

    if (!dead.length) return;

    if (!apply) {
        console.log('\nЭто был показ. Чтобы вернуть в очередь: --apply');
        return;
    }

    /**
     * Ставим задачи врозь, по одной в минуту: пачка в пятьдесят писем — это
     * снова напор на ящик, от которого всё и началось. Воркер ходит раз в
     * минуту и берёт до десяти писем за проход.
     */
    const updated = await sql`
        update system_jobs
        set status = 'queued',
            attempts = 0,
            max_attempts = 10,
            locked_by = null,
            lock_expires_at = null,
            started_at = null,
            finished_at = null,
            last_error = null,
            available_at = now() + (target.place * interval '1 minute'),
            updated_at = now()
        from (
            select id as job_id, row_number() over (order by created_at) as place
            from system_jobs
            where job_type = 'email_sent_append' and status = 'dead_letter'
        ) as target
        where system_jobs.id = target.job_id
        returning system_jobs.id
    `;

    console.log(`\nВернули в очередь: ${updated.length}. Воркер разберёт их в ближайший час.`);
}

main()
    .catch((e) => {
        console.error('Сбой:', e?.message ?? e);
        process.exitCode = 1;
    })
    .finally(() => sql.end());
