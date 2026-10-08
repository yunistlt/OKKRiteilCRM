/**
 * Перенос уставных документов юрлица с Яндекс.Диска в наше хранилище.
 *
 * Менеджеры рассылали клиентам ссылки вида
 * «Ссылка для скачивания уставных документов ООО ЗМК: disk.yandex.ru/d/…».
 * Чужое хранилище: доступ не наш, ссылка может перестать работать, состав
 * папки из системы не виден. Владелец 08.10.2026: держать документы у себя и
 * давать ссылку со своего сайта (/docs/<код>).
 *
 * Читаем публичную папку через открытый API Яндекса (ключ не нужен), рекурсивно
 * обходим вложенные папки и складываем файлы в бакет okk-assets.
 *
 * Запуск: node scripts/import-legal-docs-from-yandex.mjs <slug> <публичная ссылка>
 * Пример: node scripts/import-legal-docs-from-yandex.mjs zmk https://disk.yandex.ru/d/6DpBjK0Aj5diOA
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';

const [slug, publicKey] = process.argv.slice(2);
if (!slug || !publicKey) {
    console.error('Нужны два аргумента: код юрлица и публичная ссылка Яндекс.Диска');
    process.exit(1);
}

const env = readFileSync('.env.local', 'utf8');
const pick = (name) => (new RegExp(`^${name}=(.*)$`, 'm').exec(env)?.[1] ?? process.env[name] ?? '')
    .trim().replace(/^"|"$/g, '');

const databaseUrl = pick('DATABASE_URL');
const supabaseUrl = pick('NEXT_PUBLIC_SUPABASE_URL');
const supabaseKey = pick('SUPABASE_SERVICE_ROLE_KEY') || pick('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const BUCKET = 'okk-assets';

const sql = postgres(databaseUrl, { ssl: 'require', max: 1 });

/** То же правило имени, что в lib/legal-entity/files.ts. */
const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
};

function safeName(name) {
    let out = '';
    for (const ch of String(name ?? '').toLowerCase()) {
        if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
        else if (/[a-z0-9._-]/.test(ch)) out += ch;
        else out += '-';
    }
    return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'file';
}

/** Содержимое публичной папки. `path` — путь внутри неё. */
async function listFolder(path) {
    const url = new URL('https://cloud-api.yandex.net/v1/disk/public/resources');
    url.searchParams.set('public_key', publicKey);
    url.searchParams.set('limit', '200');
    if (path) url.searchParams.set('path', path);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Яндекс.Диск ответил ${res.status} на «${path || '/'}»`);
    const data = await res.json();
    return { name: data.name, items: data._embedded?.items ?? [] };
}

async function uploadToStorage(storagePath, bytes, contentType) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
            'Content-Type': contentType || 'application/octet-stream',
            'x-upsert': 'true',
        },
        body: bytes,
    });
    if (!res.ok) throw new Error(`Хранилище ответило ${res.status}: ${await res.text()}`);
}

const entity = (await sql`SELECT id, short_name FROM public.legal_entities WHERE public_slug = ${slug}`)[0];
if (!entity) {
    console.error(`Юрлицо с кодом «${slug}» не найдено`);
    process.exit(1);
}

console.log(`Юрлицо: ${entity.short_name}`);

let saved = 0;
let skipped = 0;

async function walk(path, folderLabel) {
    const { items } = await listFolder(path);

    for (const item of items) {
        if (item.type === 'dir') {
            await walk(item.path, item.name);
            continue;
        }

        // Качаем через ссылку, которую Яндекс выдаёт на публичный файл.
        const dl = new URL('https://cloud-api.yandex.net/v1/disk/public/resources/download');
        dl.searchParams.set('public_key', publicKey);
        dl.searchParams.set('path', item.path);

        const link = await (await fetch(dl)).json();
        if (!link.href) {
            console.warn('  пропуск (нет ссылки):', item.name);
            skipped += 1;
            continue;
        }

        const file = await fetch(link.href);
        if (!file.ok) {
            console.warn('  пропуск (не скачался):', item.name, file.status);
            skipped += 1;
            continue;
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        const folderPart = folderLabel ? `${safeName(folderLabel)}/` : '';
        const storagePath = `legal-entities/${safeName(slug)}/docs/${folderPart}${safeName(item.name)}`;

        await uploadToStorage(storagePath, bytes, item.mime_type);
        await sql`
            INSERT INTO public.legal_entity_files
                (entity_id, file_name, folder, content_type, size_bytes, storage_path, source, uploaded_by, is_public)
            VALUES (${entity.id}, ${item.name}, ${folderLabel ?? null}, ${item.mime_type ?? null},
                    ${bytes.byteLength}, ${storagePath}, ${publicKey}, 'перенос с Яндекс.Диска', TRUE)
            ON CONFLICT (entity_id, storage_path) DO UPDATE
               SET file_name = EXCLUDED.file_name,
                   size_bytes = EXCLUDED.size_bytes,
                   content_type = EXCLUDED.content_type,
                   deleted_at = NULL,
                   updated_at = now()`;

        saved += 1;
        console.log(`  ${folderLabel ? folderLabel + ' / ' : ''}${item.name} — ${Math.round(bytes.byteLength / 1024)} КБ`);
    }
}

await walk('', null);
console.log(`\nПеренесено файлов: ${saved}${skipped ? `, пропущено: ${skipped}` : ''}`);
console.log(`Ссылка для клиента: /docs/${slug}`);
await sql.end();
