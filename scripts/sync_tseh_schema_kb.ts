/**
 * Снимает схему ЦехУспеха и кладёт её в знания Тамары.
 *
 *   npm run shtab:schema-kb
 *
 * То же самое делает ночной крон /api/cron/tseh-schema-kb. Руками это нужно в
 * двух случаях: первый прогон после выкладки и проверка после того, как в базе
 * завода что-то поменяли и ждать ночи не хочется.
 *
 * Запускать можно сколько угодно раз: пока схема не менялась, отпечатки
 * совпадают и ни одного эмбеддинга не считается — то есть бесплатно.
 *
 * Нужны DATABASE_URL (или POSTGRES_URL), OPENAI_API_KEY и строка подключения к
 * базе завода в .env.local.
 */
import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { generateEmbedding } from '../lib/embeddings';
import { syncTsehSchemaToKb } from '../lib/shtab/tseh-schema-kb';

dotenv.config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!databaseUrl) {
    console.error('Нет DATABASE_URL (или POSTGRES_URL) в .env.local');
    process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
    console.error('Нет OPENAI_API_KEY: без него не посчитать эмбеддинги, а без них поиск по знаниям не работает');
    process.exit(1);
}

const local = /localhost|127\.0\.0\.1/.test(databaseUrl);
const sql = postgres(databaseUrl, { ssl: local ? false : 'require' });

async function main() {
    const report = await syncTsehSchemaToKb(sql, generateEmbedding, (m) => console.log(m));

    if (report.skipped) {
        console.log(`Пропуск: ${report.skipped}`);
        return;
    }

    console.log(
        `\nГотово. Таблиц в схеме ${report.tables}. Добавлено ${report.inserted.length}, ` +
            `обновлено ${report.updated.length}, без изменений ${report.unchanged.length}, ` +
            `погашено ${report.deactivated.length}.`,
    );
}

main()
    .catch((e) => {
        console.error('Сбой:', e instanceof Error ? e.message : e);
        process.exitCode = 1;
    })
    .finally(() => sql.end({ timeout: 5 }));
