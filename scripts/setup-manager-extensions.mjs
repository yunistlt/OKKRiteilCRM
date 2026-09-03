import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Добавочные ОП из боевого аккаунта Телфина UPQ46879 (очередь 200)
const EXTENSIONS = [
    { id: 10, extension: '105' },   // Парфенова Елена
    { id: 98, extension: '119' },   // Матвеева Евгения
    { id: 249, extension: '120' },  // Гордеева Ирина
];

const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await client.connect();

for (const { id, extension } of EXTENSIONS) {
    const { rowCount } = await client.query(
        'UPDATE public.managers SET telphin_extension = $1 WHERE id = $2',
        [extension, id]
    );
    if (rowCount) console.log(`✅ Менеджер ${id} → добавочный ${extension}`);
}

const { rows } = await client.query(
    "SELECT id, last_name, first_name, telphin_extension FROM public.managers WHERE telphin_extension IS NOT NULL ORDER BY telphin_extension"
);
console.log('\nНастроено:');
rows.forEach(r => console.log(`  доб. ${r.telphin_extension} — ${[r.last_name, r.first_name].filter(Boolean).join(' ')}`));

await client.end();
