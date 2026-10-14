/**
 * Паспорта и инструкции на продукцию — читаются прямо из ЦехУспеха.
 *
 * Андрей 14.10.2026: «не качать лишний раз себе». Копии у нас нет сознательно:
 * паспорт правят в ЦехУспехе, и копия устарела бы молча, а это тот документ,
 * который уезжает клиенту. Здесь всегда то же, что видит завод.
 *
 * Чем это платится: когда боевая база ЗМК недоступна, раздел пуст и честно об
 * этом говорит. Файлы заказов (`order_files`) от этого не зависят.
 *
 * ГЛАВНАЯ ГРАБЛЯ: не трогать `File` в поиске. `LENGTH(File)` по longblob
 * заставляет MySQL прочитать сами блобы — поиск уходит с одной секунды в
 * минуты (проверено 14.10.2026 на боевой). Поэтому размер файла в списке не
 * показывается: он становится известен только при открытии.
 */
import { queryExternal } from '@/lib/shtab/external/client';

/** Где лежит файл в ЦехУспехе. Владелец у каждого хранилища свой. */
export type DocSource = 'set' | 'detail' | 'product';

const TABLES: Record<DocSource, string> = {
    set: 'drawingssets',
    detail: 'drawingsdetails',
    product: 'drawingsproducts',
};

export const SOURCE_TITLES: Record<DocSource, string> = {
    set: 'Комплект',
    detail: 'Изделие',
    product: 'Номенклатура',
};

export type ProductDoc = {
    source: DocSource;
    fileId: number;
    /** Название комплекта или изделия в ЦехУспехе — оно часто точнее имени файла. */
    ownerName: string | null;
    fileName: string;
    changedAt: string | null;
};

/**
 * Одни и те же модели в ЗМК пишут и латиницей, и кириллицей: SL1 и СЛ1,
 * RANGER и Страж. Ищем по всем начертаниям сразу, иначе половина находок
 * пропадает, а человек видит пустой экран и решает, что паспорта нет.
 */
const LOOKALIKE: Record<string, string> = {
    a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
};
const BACK: Record<string, string> = Object.fromEntries(
    Object.entries(LOOKALIKE).map(([latin, cyrillic]) => [cyrillic, latin]),
);

function variants(word: string): string[] {
    const toCyrillic = word.replace(/[a-z]/gi, (ch) => {
        const lower = LOOKALIKE[ch.toLowerCase()];
        if (!lower) return ch;
        return ch === ch.toLowerCase() ? lower : lower.toUpperCase();
    });
    const toLatin = word.replace(/[а-яё]/gi, (ch) => {
        const lower = BACK[ch.toLowerCase()];
        if (!lower) return ch;
        return ch === ch.toLowerCase() ? lower : lower.toUpperCase();
    });
    return Array.from(new Set([word, toCyrillic, toLatin]));
}

/**
 * `%` и `_` в LIKE — подстановочные знаки, а в названиях изделий они встречаются
 * сплошь («Паспорт_Сушильный_стеллаж_SL1_Вираж_16»). Экранируем, иначе запрос
 * человека молча означает не то, что он набрал.
 */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Запрос разбивается на слова, и найтись должны ВСЕ.
 *
 * Иначе «вираж 16» не находит «Вираж-16» и «Вираж_16»: человек разделяет слова
 * пробелом, а в базе между ними то дефис, то подчёркивание, то ничего.
 * Габариты по той же причине ищутся плохо: их пишут через «×», «х» и «*», —
 * поэтому в подсказке на экране просим модель, а не размеры.
 */
function wordsOf(query: string): string[] {
    return query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

/** «поле похоже на все слова запроса, в любом начертании». */
function matchesAllWords(field: string, words: string[]): { sql: string; params: string[] } {
    const params: string[] = [];
    const perWord = words.map((word) => {
        const forms = variants(word);
        forms.forEach((form) => params.push(`%${escapeLike(form)}%`));
        return `(${forms.map(() => `${field} LIKE ?`).join(' OR ')})`;
    });
    return { sql: `(${perWord.join(' AND ')})`, params };
}

/** «подходит имя файла ИЛИ название изделия» — имена в ЦехУспехе расходятся. */
function matchesAnyField(fields: string[], words: string[]): { sql: string; params: string[] } {
    const parts = fields.map((field) => matchesAllWords(field, words));
    return {
        sql: `(${parts.map((part) => part.sql).join(' OR ')})`,
        params: parts.flatMap((part) => part.params),
    };
}

export type ProductDocFilter = {
    query: string;
    /**
     * Что искать. По умолчанию — документы для людей (паспорта и инструкции):
     * менеджеру нужны они, а чертежей и DWG в тех же таблицах на порядок
     * больше, и они забивают выдачу.
     */
    kind?: 'docs' | 'all' | 'passport' | 'instruction';
    limit?: number;
};

/**
 * «Паспорт» в базе пишут по-разному: «Паспорт», «паспорт», «- Паспорт»,
 * «БФ_Паспорт» и даже «Паспорт Паспорт». Поэтому ищем по куску слова без
 * первой буквы — так ловятся все варианты и регистр не мешает.
 */
const KIND_LIKE: Record<'docs' | 'passport' | 'instruction', string[]> = {
    docs: ['%аспорт%', '%нструк%', '%уковод%'],
    passport: ['%аспорт%'],
    instruction: ['%нструк%', '%уковод%'],
};

export async function searchProductDocs(filter: ProductDocFilter): Promise<ProductDoc[]> {
    const words = wordsOf(filter.query);
    if (!words.length) return [];

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);

    const kindClause = () => {
        const kind = filter.kind && filter.kind !== 'all' ? KIND_LIKE[filter.kind] : null;
        if (!kind) return { sql: '', params: [] as string[] };
        return {
            sql: ` AND (${kind.map(() => 'd.NameFile LIKE ?').join(' OR ')})`,
            params: kind,
        };
    };

    const sets = matchesAnyField(['d.NameFile', 's.NameSet'], words);
    const details = matchesAnyField(['d.NameFile', 'dt.NameDetail'], words);
    const products = matchesAnyField(['d.NameFile'], words);
    const kindSets = kindClause();
    const kindDetails = kindClause();
    const kindProducts = kindClause();

    const sql = `
        SELECT 'set' AS source, d.ID AS file_id, s.NameSet AS owner_name, d.NameFile, d.DateChangeFile
          FROM drawingssets d JOIN Sets s ON s.ID = d.IDSet
         WHERE ${sets.sql}${kindSets.sql}
        UNION ALL
        SELECT 'detail', d.ID, dt.NameDetail, d.NameFile, d.DateChangeFile
          FROM drawingsdetails d JOIN Details dt ON dt.ID = d.IDDetail
         WHERE ${details.sql}${kindDetails.sql}
        UNION ALL
        SELECT 'product', d.ID, NULL, d.NameFile, d.DateChangeFile
          FROM drawingsproducts d
         WHERE ${products.sql}${kindProducts.sql}
         ORDER BY DateChangeFile DESC
         LIMIT ${limit}`;

    const params = [
        ...sets.params, ...kindSets.params,
        ...details.params, ...kindDetails.params,
        ...products.params, ...kindProducts.params,
    ];

    const rows = await queryExternal<any>('tseh', sql, params);

    return rows.map((row) => ({
        source: row.source as DocSource,
        fileId: Number(row.file_id),
        ownerName: row.owner_name ? String(row.owner_name).trim() : null,
        fileName: String(row.NameFile ?? '').trim(),
        changedAt: row.DateChangeFile ? String(row.DateChangeFile) : null,
    }));
}

/** Сам файл — отдельным запросом по ID, и только когда его открывают. */
export async function readProductDoc(
    source: DocSource,
    fileId: number,
): Promise<{ fileName: string; content: Buffer } | null> {
    const table = TABLES[source];
    if (!table || !Number.isFinite(fileId)) return null;

    const rows = await queryExternal<any>(
        'tseh',
        `SELECT NameFile, File FROM ${table} WHERE ID = ? LIMIT 1`,
        [Math.trunc(fileId)],
    );
    const row = rows[0];
    if (!row?.File) return null;

    return { fileName: String(row.NameFile ?? 'Документ'), content: Buffer.from(row.File) };
}
