/**
 * Применить миграцию из `migrations/`.
 *
 * Раньше для каждой правки базы приходилось переписывать путь в
 * `scripts/apply-migration.js` — файл там зашит. Это ровно тот случай, когда
 * одноразовый скрипт живёт дольше задачи: пусть файл называют в команде.
 *
 * Запуск: npx tsx scripts/run-migration.ts migrations/20261009_xxx.sql
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
    const file = process.argv[2];
    if (!file) {
        console.error('Укажите файл: npx tsx scripts/run-migration.ts migrations/20261009_xxx.sql');
        process.exit(1);
    }

    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) {
        console.error('В .env.local нет DATABASE_URL');
        process.exit(1);
    }

    const sql = readFileSync(resolve(file), 'utf8');
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url });

    await client.connect();
    try {
        await client.query(sql);
        console.log(`применено: ${file}`);
    } catch (e: any) {
        console.error(`не применилось: ${e?.message ?? e}`);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

main();
