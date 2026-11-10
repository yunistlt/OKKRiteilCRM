import { supabase } from '@/utils/supabase';
import { extractTextFromBuffer } from '@/lib/email/attachment-parser';
import { ident, lit, runSelect } from '@/lib/mcp/sql';
import { getSchema } from '@/lib/mcp/schema';

// Файлы ОКК для коннектора: текст документа и временная ссылка на скачивание.
//
// Файл называется парой «источник:номер» — источник это таблица, где о файле
// есть запись. Сами файлы лежат в хранилище Supabase; ссылка на скачивание —
// штатная подписанная ссылка хранилища с коротким сроком, как у вложений
// мессенджера. Коннектор ничего в хранилище не кладёт и не меняет.

type Source = {
    table: string;
    name: string;
    path: string;
    /** Колонка с именем хранилища; нет колонки — хранилище одно, оно в bucket. */
    bucketColumn?: string;
    bucket?: string;
    type?: string;
    size?: string;
    deleted?: string;
    /** Уже извлечённый текст, если таблица его хранит: тогда файл не скачиваем. */
    text?: string;
};

export const FILE_SOURCES: Record<string, Source> = {
    order_files: { table: 'order_files', name: 'file_name', path: 'storage_path', bucketColumn: 'storage_bucket', type: 'content_type', size: 'size_bytes', deleted: 'deleted_at' },
    legal_matter_documents: { table: 'legal_matter_documents', name: 'file_name', path: 'storage_path', bucketColumn: 'storage_bucket', type: 'content_type', size: 'file_size_bytes', text: 'raw_text' },
    legal_enforcement_documents: { table: 'legal_enforcement_documents', name: 'file_name', path: 'storage_path', bucketColumn: 'storage_bucket', type: 'content_type', size: 'file_size_bytes', text: 'raw_text' },
    legal_entity_files: { table: 'legal_entity_files', name: 'file_name', path: 'storage_path', bucket: 'okk-assets', type: 'content_type', size: 'size_bytes', deleted: 'deleted_at' },
    legal_contract_reviews: { table: 'legal_contract_reviews', name: 'file_name', path: 'storage_path', bucketColumn: 'storage_bucket', type: 'content_type', size: 'file_size_bytes', text: 'extracted_text' },
    shtab_tamara_file: { table: 'shtab_tamara_file', name: 'file_name', path: 'storage_path', bucketColumn: 'storage_bucket', type: 'content_type', size: 'size_bytes', text: 'text_content' },
    shtab_post_doc: { table: 'shtab_post_doc', name: 'file_name', path: 'storage_path', bucketColumn: 'storage_bucket', type: 'content_type', size: 'size_bytes', text: 'text_content' },
};

/** Ссылка живёт пятнадцать минут: хватает скачать, не хватает разойтись по рукам. */
const LINK_TTL_SEC = 15 * 60;

/** Больше этого файл ради текста не скачиваем — только ссылка. */
const MAX_PARSE_BYTES = 25 * 1024 * 1024;

const TEXT_CHUNK = 40_000;

export type FileRef = { source: string; id: string };

/** «order_files:123» → источник и номер; «storage:bucket/путь» → прямой адрес в хранилище. */
export function parseFileRef(ref: string): FileRef {
    const text = String(ref ?? '').trim();
    const at = text.indexOf(':');
    if (at < 1 || at === text.length - 1) {
        throw new Error(`Файл называется «источник:номер», например order_files:123. Источники: ${Object.keys(FILE_SOURCES).join(', ')}, storage.`);
    }
    return { source: text.slice(0, at), id: text.slice(at + 1) };
}

type Located = { bucket: string; path: string; name: string; contentType: string | null; size: number | null; storedText: string | null };

async function locate(ref: FileRef): Promise<Located> {
    if (ref.source === 'storage') {
        const slash = ref.id.indexOf('/');
        if (slash < 1) throw new Error('Прямой адрес — «storage:хранилище/путь/к/файлу».');
        const path = ref.id.slice(slash + 1);
        return { bucket: ref.id.slice(0, slash), path, name: path.split('/').pop() || 'file', contentType: null, size: null, storedText: null };
    }

    const source = FILE_SOURCES[ref.source];
    if (!source) throw new Error(`Источника файлов «${ref.source}» нет. Доступны: ${Object.keys(FILE_SOURCES).join(', ')}, storage.`);

    const schema = await getSchema();
    const table = schema.tables.get(source.table);
    if (!table?.pk) throw new Error(`Таблица «${source.table}» недоступна.`);
    const has = (name?: string) => Boolean(name) && table.columns.some((c) => c.name === name);

    const pick = (column: string | undefined, as: string) => (has(column) ? `${ident(column!)} AS ${as}` : `NULL AS ${as}`);
    const rows = await runSelect<Record<string, any>>(
        `SELECT ${pick(source.name, 'name')}, ${pick(source.path, 'path')}, ${pick(source.bucketColumn, 'bucket')},
                ${pick(source.type, 'type')}, ${pick(source.size, 'size')}, ${pick(source.deleted, 'deleted')},
                ${has(source.text) ? `left(${ident(source.text!)}, 2000000) AS text` : 'NULL AS text'}
           FROM public.${ident(source.table)} WHERE ${ident(table.pk)}::text = ${lit(ref.id)} LIMIT 1`,
    );
    const row = rows[0];
    if (!row || row.deleted) throw new Error(`Файл ${ref.source}:${ref.id} не найден.`);
    if (!row.path) throw new Error(`У записи ${ref.source}:${ref.id} нет файла в хранилище.`);

    return {
        bucket: String(row.bucket || source.bucket || 'okk-assets'),
        path: String(row.path),
        name: String(row.name || String(row.path).split('/').pop() || 'file'),
        contentType: row.type ?? null,
        size: row.size === null || row.size === undefined ? null : Number(row.size),
        storedText: row.text ? String(row.text) : null,
    };
}

export async function getFile(ref: string, offset = 0, wantText = true) {
    const parsed = parseFileRef(ref);
    const file = await locate(parsed);

    const signed = await supabase.storage.from(file.bucket).createSignedUrl(file.path, LINK_TTL_SEC, { download: file.name });
    if (signed.error || !signed.data?.signedUrl) {
        throw new Error(`Файл «${file.name}» в хранилище не найден: запись о нём есть, а самого файла нет.`);
    }

    let full = file.storedText ?? '';
    let textNote: string | undefined;

    if (wantText && !full) {
        if (file.size !== null && file.size > MAX_PARSE_BYTES) {
            textNote = 'Файл больше 25 МБ — текст не извлекался, скачай по ссылке.';
        } else {
            const stored = await supabase.storage.from(file.bucket).download(file.path);
            if (stored.data) {
                const buffer = Buffer.from(await stored.data.arrayBuffer());
                if (buffer.length > MAX_PARSE_BYTES) {
                    textNote = 'Файл больше 25 МБ — текст не извлекался, скачай по ссылке.';
                } else {
                    full = await extractTextFromBuffer(buffer, file.name);
                    if (!full.trim()) textNote = 'Текста в файле нет или формат не читается (картинка, скан, чертёж) — скачай по ссылке.';
                }
            }
        }
    }

    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const text = full.slice(start, start + TEXT_CHUNK);
    const rest = full.length - (start + text.length);

    return {
        file: `${parsed.source}:${parsed.id}`,
        name: file.name,
        content_type: file.contentType,
        size_bytes: file.size,
        download_url: signed.data.signedUrl,
        download_url_expires_in_sec: LINK_TTL_SEC,
        text: wantText ? text : undefined,
        text_length: wantText ? full.length : undefined,
        next_offset: wantText && rest > 0 ? start + text.length : null,
        note: textNote,
    };
}
