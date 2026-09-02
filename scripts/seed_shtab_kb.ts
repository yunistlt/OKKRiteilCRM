/**
 * Засевает знания Тамары.
 *
 *   npm run shtab:seed-kb
 *
 * Берёт статьи из lib/shtab/kb-content.ts, считает по каждой эмбеддинг и кладёт
 * в shtab_kb. Запускать можно сколько угодно раз: строки обновляются по slug,
 * дубликатов не появляется, а эмбеддинг пересчитывается только у изменившихся
 * статей — каждый пересчёт платный.
 *
 * Нужны DATABASE_URL (или POSTGRES_URL) и OPENAI_API_KEY в .env.local.
 */
import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { generateEmbedding } from '../lib/embeddings';
import { seedShtabKb } from '../lib/shtab/kb-seed';

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
    // Проверяем таблицу до первого вызова эмбеддингов: иначе ошибка вылезет
    // после того, как деньги уже потрачены.
    const [{ exists }] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'shtab_kb'
        ) AS exists
    `;
    if (!exists) {
        throw new Error('Таблицы shtab_kb нет. Примени migrations/20260826_shtab_tamara.sql');
    }

    const report = await seedShtabKb(sql, generateEmbedding, (m) => console.log(m));
    console.log(
        `\nГотово. Добавлено ${report.inserted.length}, обновлено ${report.updated.length}, ` +
            `без изменений ${report.unchanged.length}, погашено ${report.deactivated.length}.`,
    );
}

main()
    .catch((e) => {
        console.error('Сбой:', e instanceof Error ? e.message : e);
        process.exitCode = 1;
    })
    .finally(() => sql.end({ timeout: 5 }));
