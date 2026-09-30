/**
 * Схема базы ЦехУспеха в знаниях Тамары.
 *
 * Зачем. Разбор одного вопроса про заказы недели стоил 26 вызовов инструментов,
 * и 18 из них были разведкой: какие есть таблицы с «order», какие колонки у
 * orders, у ordersplan, у billsfromsuppliers… Каждый вопрос — заново, с нуля.
 * Дорого это вдвойне: ответы information_schema не только оплачиваются сами, но
 * и едут к модели на каждом следующем витке разбора.
 *
 * Снимок схемы у нас был и раньше — docs/shtab/schemas/tseh.md, снят вручную с
 * боевой базы. Толку от него Тамаре не было никакого: файл читают люди, а в её
 * контекст попадает только то, что лежит в shtab_kb. Поэтому схема переезжает
 * в знания — туда же, где остальное, чем она пользуется.
 *
 * Почему снимаем сами, а не копируем файл. База живёт: таблицы добавляются,
 * колонки переименовываются. Ручной снимок протухает молча, и Тамара начинает
 * писать запросы по колонкам, которых уже нет. Ночью крон снимает схему заново
 * и, если она изменилась, обновляет статьи.
 *
 * Здесь только чтение information_schema — ни одного запроса к данным завода.
 */
import type { Sql } from 'postgres';
import { queryExternal, externalDbConfigured } from '@/lib/shtab/external/client';
import { kbFingerprint, SCHEMA_SLUG_PREFIX, type Embedder } from '@/lib/shtab/kb-seed';

export { SCHEMA_SLUG_PREFIX };

/** Вид статьи. Заведён отдельным, чтобы снимок базы не путался с методичкой. */
export const SCHEMA_KB_TYPE = 'schema';

export const SCHEMA_SOURCE_REF = 'Снимок схемы ЦехУспеха (MySQL), снят ночью автоматически';

export type TsehColumn = {
    table: string;
    column: string;
    type: string;
    nullable: boolean;
    key: string;
    comment: string;
};

export type TsehTable = { table: string; columns: TsehColumn[] };

/**
 * Снимает схему одним запросом.
 *
 * Одним, а не по таблице на вызов: 214 таблиц — это 214 обращений к чужой базе,
 * на которой работает завод, и у учётки Тамары стоит потолок в 5000 запросов в
 * час. Сортировка задана явно — от неё зависит отпечаток, а значит и решение
 * «схема не менялась, платить за эмбеддинги не надо».
 */
export async function fetchTsehSchema(): Promise<TsehTable[]> {
    const rows = await queryExternal<{
        TABLE_NAME: string;
        COLUMN_NAME: string;
        COLUMN_TYPE: string;
        IS_NULLABLE: string;
        COLUMN_KEY: string;
        COLUMN_COMMENT: string | null;
    }>(
        'tseh',
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );

    const byTable = new Map<string, TsehTable>();
    for (const r of rows) {
        const table = String(r.TABLE_NAME);
        if (!byTable.has(table)) byTable.set(table, { table, columns: [] });
        byTable.get(table)!.columns.push({
            table,
            column: String(r.COLUMN_NAME),
            type: String(r.COLUMN_TYPE),
            nullable: String(r.IS_NULLABLE).toUpperCase() === 'YES',
            key: String(r.COLUMN_KEY ?? ''),
            comment: String(r.COLUMN_COMMENT ?? ''),
        });
    }
    return Array.from(byTable.values());
}

/**
 * Разбивка таблиц по темам.
 *
 * Поиск по знаниям отдаёт в контекст всего четыре статьи, поэтому нарезать по
 * таблице на статью нельзя: на вопрос про заказы приедут четыре случайные из
 * двухсот. Группы названы по-русски и по смыслу — по ним и ищется.
 *
 * Порядок важен: таблица попадает в первую подошедшую группу, поэтому узкие
 * правила стоят раньше широких. `itemsordersbillsfromsuppliers` — это про счета
 * поставщиков, а не про заказы клиентов, хотя «orders» в имени есть.
 */
const GROUPS: Array<{ key: string; title: string; tags: string[]; match: (t: string) => boolean }> = [
    {
        key: 'postavshchiki',
        title: 'Таблицы ЦехУспеха: поставщики, счета и приход материалов',
        tags: ['цехуспех', 'схема', 'поставщики', 'счета', 'закупки', 'материалы', 'склад'],
        match: (t) => /supplier|bill|import|wh$|warehouse/.test(t),
    },
    {
        key: 'zakazy',
        title: 'Таблицы ЦехУспеха: заказы, их состав и статусы',
        tags: ['цехуспех', 'схема', 'заказы', 'план', 'статусы', 'состав заказа', 'отгрузка'],
        match: (t) => /order/.test(t),
    },
    {
        key: 'proizvodstvo',
        title: 'Таблицы ЦехУспеха: производство, наряды и техкарты',
        tags: ['цехуспех', 'схема', 'производство', 'наряды', 'техкарты', 'операции', 'цех'],
        match: (t) => /task|oper|tech|route|product|plan|shift|nomenclature/.test(t),
    },
    {
        key: 'lyudi',
        title: 'Таблицы ЦехУспеха: сотрудники, зарплата и контрагенты',
        tags: ['цехуспех', 'схема', 'сотрудники', 'зарплата', 'контрагенты', 'клиенты', 'люди'],
        match: (t) => /employ|staff|salary|person|user|agent|client|counterpart|firm/.test(t),
    },
];

const REST_GROUP = {
    key: 'prochee',
    title: 'Таблицы ЦехУспеха: всё остальное',
    tags: ['цехуспех', 'схема', 'справочники', 'таблицы', 'прочее'],
};

function groupOf(table: string): string {
    const lower = table.toLowerCase();
    for (const g of GROUPS) if (g.match(lower)) return g.key;
    return REST_GROUP.key;
}

/** Одна таблица в тексте статьи: имя, за ним колонки через запятую. */
function renderTable(t: TsehTable): string {
    const cols = t.columns
        .map((c) => {
            const marks = [c.key === 'PRI' ? 'ключ' : '', c.nullable ? '' : 'обязательное']
                .filter(Boolean)
                .join(', ');
            const tail = [c.type, marks, c.comment].filter(Boolean).join('; ');
            return `${c.column} (${tail})`;
        })
        .join(', ');
    return `${t.table}: ${cols}`;
}

export type SchemaArticle = {
    slug: string;
    title: string;
    content: string;
    tags: string[];
};

/**
 * Статьи из снятой схемы: по одной на тему плюс общий список таблиц.
 *
 * Общий список нужен на случай, когда таблица не нашлась в своей группе:
 * по нему видно, что вообще есть в базе, и не приходится идти в SHOW TABLES.
 */
export function buildSchemaArticles(tables: TsehTable[]): SchemaArticle[] {
    const sorted = [...tables].sort((a, b) => a.table.localeCompare(b.table));
    const articles: SchemaArticle[] = [];

    const preamble =
        'Это снимок схемы базы ЦехУспеха (MySQL 8, схема zmk). Пиши запросы по нему, ' +
        'не выясняя строение базы заново: SHOW TABLES и information_schema нужны, только если ' +
        'нужной таблицы здесь нет. Внешних ключей в базе нет вовсе, связи логические — по полям ID*.';

    for (const g of [...GROUPS, REST_GROUP]) {
        const mine = sorted.filter((t) => groupOf(t.table) === g.key);
        if (mine.length === 0) continue;
        articles.push({
            slug: `${SCHEMA_SLUG_PREFIX}${g.key}`,
            title: g.title,
            tags: g.tags,
            content: `${preamble}\n\nТаблиц в этой части: ${mine.length}.\n\n${mine.map(renderTable).join('\n')}`,
        });
    }

    articles.push({
        slug: `${SCHEMA_SLUG_PREFIX}spisok`,
        title: 'Таблицы ЦехУспеха: полный список',
        tags: ['цехуспех', 'схема', 'список таблиц', 'какие есть таблицы', 'база завода'],
        content:
            `${preamble}\n\nВсего таблиц: ${sorted.length}. Через тире — сколько в таблице колонок.\n\n` +
            sorted.map((t) => `${t.table} — ${t.columns.length}`).join('\n'),
    });

    return articles;
}

/** Текст, по которому считается эмбеддинг и отпечаток. Тот же порядок, что у рукописных статей. */
export function formatArticleForEmbedding(a: SchemaArticle): string {
    return [a.title, a.tags.join(', '), a.content].join('\n\n');
}

export type SchemaSyncReport = {
    tables: number;
    inserted: string[];
    updated: string[];
    unchanged: string[];
    deactivated: string[];
    skipped?: string;
};

/**
 * Сверяет снимок с тем, что уже лежит в знаниях, и обновляет только изменившееся.
 *
 * Отпечаток текста решает, платить ли за эмбеддинг: схема завода меняется
 * редко, а крон ходит каждую ночь, и пересчитывать двести таблиц впустую — это
 * деньги на ровном месте. Статьи, исчезнувшие из снимка, гасятся, но трогаем мы
 * только свои: рукописные знания живут по своим правилам и сюда не относятся.
 */
export async function syncTsehSchemaToKb(
    sql: Sql,
    embed: Embedder,
    onProgress: (message: string) => void = () => {},
): Promise<SchemaSyncReport> {
    if (!externalDbConfigured('tseh')) {
        return { tables: 0, inserted: [], updated: [], unchanged: [], deactivated: [], skipped: 'база завода не подключена' };
    }

    const tables = await fetchTsehSchema();
    const articles = buildSchemaArticles(tables);
    const report: SchemaSyncReport = { tables: tables.length, inserted: [], updated: [], unchanged: [], deactivated: [] };

    const existing = await sql<{ slug: string; fp: string | null }[]>`
        SELECT slug, metadata_fingerprint AS fp
          FROM public.shtab_kb
         WHERE slug LIKE ${SCHEMA_SLUG_PREFIX + '%'}
    `;
    const fpBySlug = new Map(existing.map((r) => [r.slug, r.fp]));

    for (const a of articles) {
        const text = formatArticleForEmbedding(a);
        const fp = kbFingerprint(text);

        if (fpBySlug.get(a.slug) === fp) {
            report.unchanged.push(a.slug);
            continue;
        }

        const embedding = await embed(text);
        const vector = `[${embedding.join(',')}]`;
        const wasThere = fpBySlug.has(a.slug);

        await sql`
            INSERT INTO public.shtab_kb
                (slug, type, title, content, tags, source_ref, is_active, embedding, metadata_fingerprint, updated_at)
            VALUES (
                ${a.slug}, ${SCHEMA_KB_TYPE}, ${a.title}, ${a.content},
                ${a.tags}, ${SCHEMA_SOURCE_REF}, true, ${vector}::vector, ${fp}, now()
            )
            ON CONFLICT (slug) DO UPDATE SET
                type       = EXCLUDED.type,
                title      = EXCLUDED.title,
                content    = EXCLUDED.content,
                tags       = EXCLUDED.tags,
                source_ref = EXCLUDED.source_ref,
                is_active  = true,
                embedding  = EXCLUDED.embedding,
                metadata_fingerprint = EXCLUDED.metadata_fingerprint,
                updated_at = now()
        `;

        (wasThere ? report.updated : report.inserted).push(a.slug);
        onProgress(`  ${wasThere ? 'обновил' : 'добавил'} ${a.slug} — ${a.title}`);
    }

    const slugs = articles.map((a) => a.slug);
    const removed = await sql<{ slug: string }[]>`
        UPDATE public.shtab_kb
           SET is_active = false, updated_at = now()
         WHERE is_active
           AND slug LIKE ${SCHEMA_SLUG_PREFIX + '%'}
           AND slug <> ALL(${slugs})
        RETURNING slug
    `;
    for (const r of removed) {
        report.deactivated.push(r.slug);
        onProgress(`  погасил ${r.slug} — такой части в схеме больше нет`);
    }

    return report;
}
