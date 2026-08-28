import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';

// Разбор исходников ЦехУспеха для РАГ-базы Тамары.
//
// Зачем это вообще. Тела хранимых функций read-only учётке MySQL не видны:
// information_schema отдаёт 53 функции и ноль тел. А без них Тамара не может
// объяснить, откуда взялась цифра, — только назвать её. Поэтому логика кладётся
// в РАГ (по общему правилу проекта: знания ИИ живут в базе знаний, а не прозой
// в коде), а источником служат локальный дамп схемы и папка с исходниками.
//
// Папка ЦехУспеха — только для чтения. Здесь нет ни одной записи в неё, и
// появиться не должно: это боевая система без истории версий.
//
// Отдельно про границу. В РАГ попадает код чужой программы, поэтому у каждой
// записи есть путь к источнику: любую строку ответа Тамары можно проверить по
// оригиналу, а не принимать на веру.

export type TsehCodeKind = 'function' | 'table' | 'unit';

export type TsehCodeDoc = {
    /** Уникальный ключ записи: kind:name[:номер куска]. */
    slug: string;
    kind: TsehCodeKind;
    /** Имя функции, таблицы или модуля. */
    name: string;
    /** Откуда взято — файл дампа или .pas. */
    sourceRef: string;
    title: string;
    content: string;
};

/** Отпечаток текста: по нему видно, надо ли пересчитывать эмбеддинг. */
export function codeFingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ── дамп MySQL ────────────────────────────────────────────────────────────────

/**
 * Тела хранимых функций из дампа.
 *
 * Дамп разделяет процедуры строкой `;;` (DELIMITER), поэтому конец тела ищется
 * по ней, а не по слову END: END встречается внутри каждого IF.
 */
export function parseFunctions(dump: string): Array<{ name: string; body: string }> {
    const out: Array<{ name: string; body: string }> = [];
    const re = /CREATE\s+DEFINER=[^\n]*?\s(FUNCTION|PROCEDURE)\s+`([^`]+)`([\s\S]*?)\n\s*END\s*;;/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(dump)) !== null) {
        out.push({ name: m[2], body: `CREATE ${m[1]} \`${m[2]}\`${m[3]}\nEND` });
    }
    return out;
}

/** Структура таблиц: имя, колонки с типами. Данные из дампа не берутся. */
export function parseTables(dump: string): Array<{ name: string; columns: string[] }> {
    const out: Array<{ name: string; columns: string[] }> = [];
    const re = /CREATE TABLE `([^`]+)` \(\n([\s\S]*?)\n\) ENGINE/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(dump)) !== null) {
        const columns = m[2]
            .split('\n')
            .map((line) => line.trim().replace(/,$/, ''))
            .filter((line) => line.startsWith('`'))
            .map((line) => {
                const col = /^`([^`]+)` (.+)$/.exec(line);
                return col ? `${col[1]} — ${col[2]}` : line;
            });
        out.push({ name: m[1], columns });
    }
    return out;
}

// ── исходники Delphi ──────────────────────────────────────────────────────────

const MAX_CHUNK = 6000;

/**
 * Режет .pas на куски по границам процедур и функций.
 *
 * По границам, а не по числу символов подряд: разрезанная посередине процедура
 * даёт кусок, который выглядит осмысленно и означает не то — это худший вид
 * материала для РАГ. Слишком мелкие куски слипаются обратно до MAX_CHUNK.
 */
export function chunkPascal(source: string): string[] {
    const lines = source.split('\n');
    const starts: number[] = [];
    lines.forEach((line, i) => {
        if (/^\s*(procedure|function|constructor|destructor)\s+\w/i.test(line)) starts.push(i);
    });

    if (starts.length === 0) return splitLong(source);

    const blocks: string[] = [];
    if (starts[0] > 0) blocks.push(lines.slice(0, starts[0]).join('\n'));
    starts.forEach((start, i) => {
        const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
        blocks.push(lines.slice(start, end).join('\n'));
    });

    const chunks: string[] = [];
    let buffer = '';
    for (const block of blocks) {
        if (block.trim() === '') continue;
        if (block.length > MAX_CHUNK) {
            if (buffer) {
                chunks.push(buffer);
                buffer = '';
            }
            chunks.push(...splitLong(block));
            continue;
        }
        if (buffer.length + block.length > MAX_CHUNK) {
            chunks.push(buffer);
            buffer = block;
        } else {
            buffer = buffer ? `${buffer}\n${block}` : block;
        }
    }
    if (buffer.trim()) chunks.push(buffer);
    return chunks.filter((c) => c.trim().length > 0);
}

function splitLong(text: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += MAX_CHUNK) out.push(text.slice(i, i + MAX_CHUNK));
    return out.filter((c) => c.trim().length > 0);
}

// ── сборка записей ────────────────────────────────────────────────────────────

export function docsFromDump(dump: string, sourceRef: string): TsehCodeDoc[] {
    const docs: TsehCodeDoc[] = [];

    for (const fn of parseFunctions(dump)) {
        docs.push({
            slug: `function:${fn.name}`,
            kind: 'function',
            name: fn.name,
            sourceRef,
            title: `Функция ЦехУспеха ${fn.name}`,
            content: fn.body,
        });
    }

    for (const table of parseTables(dump)) {
        docs.push({
            slug: `table:${table.name}`,
            kind: 'table',
            name: table.name,
            sourceRef,
            title: `Таблица ЦехУспеха ${table.name}`,
            content: `Таблица ${table.name}, колонки:\n${table.columns.join('\n')}`,
        });
    }

    return docs;
}

/**
 * Структура таблиц из живой базы, а не из дампа.
 *
 * Дамп снят однажды и уже отстал: в нём 198 таблиц против 214 в базе. Колонки
 * read-only учётке видны полностью, поэтому структура берётся оттуда, а из
 * дампа — только тела функций, которых учётке не видно.
 */
export function docsFromColumns(
    rows: Array<{ table: string; column: string; type: string; nullable?: string }>,
    sourceRef: string,
): TsehCodeDoc[] {
    const byTable = new Map<string, string[]>();
    for (const r of rows) {
        const list = byTable.get(r.table) ?? [];
        list.push(`${r.column} — ${r.type}${r.nullable === 'NO' ? ', обязательное' : ''}`);
        byTable.set(r.table, list);
    }
    return Array.from(byTable.entries()).map(([name, columns]) => ({
        slug: `table:${name}`,
        kind: 'table' as const,
        name,
        sourceRef,
        title: `Таблица ЦехУспеха ${name}`,
        content: `Таблица ${name}, колонки:\n${columns.join('\n')}`,
    }));
}

export function docsFromPascal(fileName: string, source: string, sourceRef: string): TsehCodeDoc[] {
    const unit = fileName.replace(/\.pas$/i, '');
    return chunkPascal(source).map((content, i) => ({
        slug: `unit:${unit}:${i}`,
        kind: 'unit' as const,
        name: unit,
        sourceRef: `${sourceRef}${i > 0 ? ` (часть ${i + 1})` : ''}`,
        title: `Форма ЦехУспеха ${unit}${i > 0 ? `, часть ${i + 1}` : ''}`,
        content,
    }));
}

/** Текст, по которому считается эмбеддинг: заголовок помогает попадать в поиск. */
export function formatForEmbedding(doc: TsehCodeDoc): string {
    return `${doc.title}\n\n${doc.content}`;
}

// ── засев ─────────────────────────────────────────────────────────────────────

export type Embedder = (text: string) => Promise<number[]>;

export type IndexReport = { inserted: number; updated: number; unchanged: number; deactivated: number };

/**
 * Кладёт разобранный код в shtab_tseh_code.
 *
 * Устройство повторяет засев базы знаний: отпечаток текста, чтобы не платить за
 * эмбеддинг того, что не менялось, и гашение вместо удаления.
 */
export async function indexTsehCode(
    sql: Sql,
    docs: TsehCodeDoc[],
    embed: Embedder,
    onProgress: (message: string) => void = () => {},
): Promise<IndexReport> {
    const slugs = docs.map((d) => d.slug);
    const duplicates = Array.from(new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i)));
    if (duplicates.length > 0) {
        throw new Error(`Повторяющиеся slug: ${duplicates.slice(0, 5).join(', ')}`);
    }

    const existing = await sql<{ slug: string; fp: string | null }[]>`
        SELECT slug, fingerprint AS fp FROM public.shtab_tseh_code
    `;
    const fpBySlug = new Map(existing.map((r) => [r.slug, r.fp]));

    const report: IndexReport = { inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };

    for (const doc of docs) {
        const text = formatForEmbedding(doc);
        const fp = codeFingerprint(text);
        if (fpBySlug.get(doc.slug) === fp) {
            report.unchanged += 1;
            continue;
        }

        const vector = `[${(await embed(text)).join(',')}]`;
        const wasThere = fpBySlug.has(doc.slug);

        await sql`
            INSERT INTO public.shtab_tseh_code
                (slug, kind, name, title, content, source_ref, is_active, embedding, fingerprint, updated_at)
            VALUES (
                ${doc.slug}, ${doc.kind}, ${doc.name}, ${doc.title}, ${doc.content},
                ${doc.sourceRef}, true, ${vector}::vector, ${fp}, now()
            )
            ON CONFLICT (slug) DO UPDATE SET
                kind = EXCLUDED.kind, name = EXCLUDED.name, title = EXCLUDED.title,
                content = EXCLUDED.content, source_ref = EXCLUDED.source_ref,
                is_active = true, embedding = EXCLUDED.embedding,
                fingerprint = EXCLUDED.fingerprint, updated_at = now()
        `;

        report[wasThere ? 'updated' : 'inserted'] += 1;
        if ((report.inserted + report.updated) % 100 === 0) {
            onProgress(`  обработано ${report.inserted + report.updated}`);
        }
    }

    const removed = await sql<{ slug: string }[]>`
        UPDATE public.shtab_tseh_code
           SET is_active = false, updated_at = now()
         WHERE is_active AND slug <> ALL(${slugs})
        RETURNING slug
    `;
    report.deactivated = removed.length;

    return report;
}
