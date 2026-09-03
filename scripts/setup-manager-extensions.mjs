import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Добавочные Телфина (аккаунт UPQ46879). Пока обкатываем телефон в интерфейсе —
// добавочный стоит ТОЛЬКО у Андрея: чужие аппараты от чужих кликов звонить не должны.
// Когда откроем отделу — раскомментировать ОП и прогнать скрипт заново.
const EXTENSIONS = [
    { id: 102, extension: '108' },  // Теренков Андрей
    { id: 999, extension: '108' },  // Системный Администратор — к нему привязана учётка admin Андрея
    // { id: 10,  extension: '105' },  // Парфенова Елена
    // { id: 98,  extension: '119' },  // Матвеева Евгения
    // { id: 249, extension: '120' },  // Гордеева Ирина
];

const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await client.connect();

const keep = EXTENSIONS.map((e) => e.id);
await client.query(
    'UPDATE public.managers SET telphin_extension = NULL WHERE telphin_extension IS NOT NULL AND NOT (id = ANY($1::bigint[]))',
    [keep]
);

for (const { id, extension } of EXTENSIONS) {
    await client.query('UPDATE public.managers SET telphin_extension = $1 WHERE id = $2', [extension, id]);
}

const { rows } = await client.query(
    'SELECT id, last_name, first_name, telphin_extension FROM public.managers WHERE telphin_extension IS NOT NULL ORDER BY telphin_extension'
);
console.log('Звонить из интерфейса могут:');
rows.forEach((r) => console.log(`  доб. ${r.telphin_extension} — ${[r.last_name, r.first_name].filter(Boolean).join(' ')}`));

await client.end();
