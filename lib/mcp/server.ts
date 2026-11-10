import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logCall } from '@/lib/mcp/keys';
import type { McpKey } from '@/lib/mcp/keys';
import { getSchema, linksOf, requireTable } from '@/lib/mcp/schema';
import type { Schema, Table } from '@/lib/mcp/schema';
import { DEFAULT_LIMIT, MAX_LIMIT, getEntity, listEntities } from '@/lib/mcp/entities';
import { searchEverywhere } from '@/lib/mcp/search';
import { getArticle, listKnowledgeBases, searchKnowledge } from '@/lib/mcp/knowledge';
import { listFunctions, runFunction } from '@/lib/mcp/functions';
import { FILE_SOURCES, getFile } from '@/lib/mcp/files';
import { MAX_QUERY_ROWS, MAX_RESPONSE_BYTES, runUserQuery } from '@/lib/mcp/sql';
import { referencedRelations } from '@/lib/shtab/tamara-sql';

// Сервер коннектора Claude к ОКК: набор инструментов чтения.
//
// Инструменты универсальные — «список объектов любой таблицы», «карточка»,
// «поиск», — а не по одному на раздел. Что есть в системе, Claude узнаёт из
// реестра разделов и карты данных, поэтому новый раздел появляется в коннекторе
// без правки этого файла.
//
// Сервер собирается заново на каждый запрос и состояния не держит: ключ
// сотрудника известен уже здесь и попадает в журнал каждого вызова.

const INSTRUCTIONS = [
    'Коннектор к ОКК — системе учёта завода ЗМК: заказы, клиенты, звонки с расшифровками, почта, контроль качества, зарплата отдела продаж, юридический отдел, Штаб владельца, базы знаний.',
    'Только чтение. Суммы — в рублях числом (поля с окончанием _kopecks — в копейках), даты — ISO 8601.',
    'С чего начинать: list_sections → describe_section(раздел) → list_entities / get_entity. Не знаешь таблицу — schema_lookup по слову. Нужен расчёт или сводка, которых нет готовыми, — run_query.',
    'RetailCRM — архив: таблицы с началом retailcrm_ не пополняются, актуальные данные лежат в остальных.',
].join('\n');

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Сколько объектов в ответе — для журнала. */
function countOf(result: any): number {
    if (!result || typeof result !== 'object') return 0;
    if (typeof result.count === 'number') return result.count;
    if (typeof result.row_count === 'number') return result.row_count;
    return 1;
}

function fit(result: unknown): string {
    const text = JSON.stringify(result);
    if (text.length <= MAX_RESPONSE_BYTES * 1.2) return text;
    return JSON.stringify({
        truncated: true,
        note: 'Ответ больше допустимого размера и обрезан. Сузь запрос: период, фильтр, меньший limit.',
        partial: text.slice(0, MAX_RESPONSE_BYTES),
    });
}

function tableBrief(t: Table) {
    return { type: t.name, kind: t.kind === 'view' ? 'представление' : 'таблица', description: t.comment, rows: t.rows };
}

function assertSectionOpen(key: McpKey, section: string) {
    if (key.closedSections.includes(section)) throw new Error('Этот раздел для вашего ключа закрыт.');
}

function openTable(schema: Schema, key: McpKey, name: string): Table {
    const table = requireTable(schema, name);
    assertSectionOpen(key, table.section);
    return table;
}

const filterShape = z.object({
    field: z.string().describe('Имя поля'),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in', 'is_null', 'not_null']).optional().describe('Сравнение. По умолчанию eq. like — вхождение без учёта регистра'),
    value: z.any().optional().describe('Значение; для in — массив'),
});

export function buildServer(key: McpKey): McpServer {
    const server = new McpServer({ name: 'okk', version: '1.0.0' }, { instructions: INSTRUCTIONS });

    /** Обёртка каждого инструмента: журнал, размер ответа, ошибка человеческим текстом. */
    const tool = <S extends z.ZodRawShape>(
        name: string,
        description: string,
        inputSchema: S,
        handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
    ) => {
        server.registerTool(
            name,
            { description, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
            (async (args: any): Promise<ToolResult> => {
                const startedAt = Date.now();
                try {
                    const result = await handler(args);
                    await logCall(key, name, args, countOf(result), Date.now() - startedAt, null);
                    return { content: [{ type: 'text', text: fit(result) }] };
                } catch (e: any) {
                    const message = String(e?.message ?? e).slice(0, 1000);
                    await logCall(key, name, args, 0, Date.now() - startedAt, message);
                    return { content: [{ type: 'text', text: message }], isError: true };
                }
            }) as any,
        );
    };

    // ── навигация ─────────────────────────────────────────────────────────────

    tool(
        'list_sections',
        'Каталог разделов ОКК: название, что в разделе лежит, сколько в нём таблиц и функций. С этого начинают, когда непонятно, где искать данные. Пример: list_sections().',
        {},
        async () => {
            const schema = await getSchema();
            const functions = listFunctions(undefined, key.closedSections).functions;
            const sections = schema.sections
                .filter((s) => !key.closedSections.includes(s.key))
                .map((s) => {
                    const tables = Array.from(schema.tables.values()).filter((t) => t.section === s.key);
                    return {
                        section: s.key,
                        title: s.title,
                        description: s.description,
                        entities: tables.map((t) => t.name).sort(),
                        functions: functions.filter((f) => f.section === s.key).map((f) => f.name),
                    };
                })
                .filter((s) => s.entities.length > 0 || s.functions.length > 0);
            return { sections, count: sections.length };
        },
    );

    tool(
        'describe_section',
        'Подробности раздела: его таблицы с описаниями и числом строк, связи между ними, доступные функции и примеры вызовов. Пример: describe_section({section: "orders"}).',
        { section: z.string().describe('Код раздела из list_sections, например orders, calls, salary') },
        async ({ section }) => {
            const schema = await getSchema();
            const found = schema.sections.find((s) => s.key === section);
            if (!found) throw new Error(`Раздела «${section}» нет. Коды разделов — в list_sections.`);
            assertSectionOpen(key, found.key);

            const tables = Array.from(schema.tables.values()).filter((t) => t.section === found.key).sort((a, b) => a.name.localeCompare(b.name));
            const names = new Set(tables.map((t) => t.name));
            const links = schema.links.filter((l) => names.has(l.from.split('.')[0]) || names.has(l.to.split('.')[0]));
            const first = tables[0]?.name ?? 'orders';

            return {
                section: found.key,
                title: found.title,
                description: found.description,
                entities: tables.map(tableBrief),
                links,
                functions: listFunctions(found.key, key.closedSections).functions.map((f) => ({ name: f.name, description: f.description })),
                examples: [
                    `schema_lookup({query: "${first}"}) — поля таблицы с описаниями`,
                    `list_entities({type: "${first}", limit: 20}) — последние записи`,
                    `get_entity({type: "${first}", id: "…"}) — карточка целиком`,
                ],
                count: tables.length,
            };
        },
    );

    // ── данные любого раздела ─────────────────────────────────────────────────

    tool(
        'search',
        'Поиск по словам сразу в нескольких разделах: заказы (номер, клиент, телефон, товар), клиенты (название, ИНН, почта), менеджеры, письма (тема, отправитель), файлы заказов, юридические дела, доработки. Возвращает тип, id, заголовок и кусок текста с найденным. Расшифровки звонков и тела писем сюда не входят — для них run_query с периодом. Пример: search({query: "Газпром"}) или search({query: "7707083893", type: "clients"}).',
        {
            query: z.string().describe('Что ищем: слово, часть названия, номер, ИНН, телефон'),
            section: z.string().optional().describe('Искать только в этом разделе (код из list_sections)'),
            type: z.string().optional().describe('Искать только в этой таблице, например orders'),
            from: z.string().optional().describe('Начало периода, ISO 8601 (включительно)'),
            to: z.string().optional().describe('Конец периода, ISO 8601 (не включая)'),
        },
        async (args) => searchEverywhere({ ...args, closedSections: key.closedSections }),
    );

    tool(
        'list_entities',
        `Список объектов любой таблицы ОКК с фильтрами, периодом и сортировкой. По умолчанию ${DEFAULT_LIMIT} записей, не больше ${MAX_LIMIT}; дальше — по next_cursor. Тяжёлые поля (JSON) в список не входят, длинный текст обрезается — полная запись в get_entity. Пример: list_entities({type: "orders", filters: [{field: "manager_id", value: 249}], period: {field: "created_at", from: "2026-11-01"}, sort: {field: "totalsumm", dir: "desc"}}).`,
        {
            type: z.string().describe('Имя таблицы или представления, например orders, clients, raw_telphin_calls'),
            filters: z.array(filterShape).optional().describe('Условия по полям, все должны выполняться'),
            period: z.object({
                field: z.string().describe('Поле с датой'),
                from: z.string().optional().describe('С какого момента, ISO 8601 (включительно)'),
                to: z.string().optional().describe('По какой момент, ISO 8601 (не включая)'),
            }).optional().describe('Отбор по дате'),
            sort: z.object({
                field: z.string().describe('Поле сортировки'),
                dir: z.enum(['asc', 'desc']).optional().describe('По умолчанию desc'),
            }).optional().describe('Сортировка. По умолчанию — по ключу, новые сверху'),
            fields: z.array(z.string()).optional().describe('Вернуть только эти поля (так можно взять и тяжёлые)'),
            limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Сколько записей, по умолчанию ${DEFAULT_LIMIT}`),
            cursor: z.string().optional().describe('Значение next_cursor из прошлого ответа'),
        },
        async (args) => {
            openTable(await getSchema(), key, args.type);
            return listEntities(args as any);
        },
    );

    tool(
        'get_entity',
        'Полная карточка одного объекта: все поля и готовые ссылки на связанное (товары, оплаты, история правок, звонки, файлы заказа и т. п.) — каждую ссылку можно сразу передать в list_entities. У заказа id — это поле id таблицы orders, а не номер; по номеру заказ находят так: list_entities({type: "orders", filters: [{field: "number", value: "900089"}]}). Пример: get_entity({type: "clients", id: "12345"}).',
        {
            type: z.string().describe('Имя таблицы'),
            id: z.union([z.string(), z.number()]).describe('Значение ключевого поля объекта'),
        },
        async ({ type, id }) => {
            openTable(await getSchema(), key, type);
            return getEntity(type, id);
        },
    );

    tool(
        'get_file',
        `Файл из ОКК: извлечённый текст (PDF, DOCX, XLSX, TXT, архивы) и временная ссылка на скачивание, действует 15 минут. Файл называется «источник:номер»; источники: ${Object.keys(FILE_SOURCES).join(', ')}. Номера файлов заказа — в list_entities({type: "order_files", filters: [{field: "order_number", value: "…"}]}). Файл по прямому адресу в хранилище — «storage:хранилище/путь» (так берутся вложения мессенджера и писем). Пример: get_file({file: "order_files:4521"}).`,
        {
            file: z.string().describe('Файл в виде «источник:номер», например order_files:4521'),
            offset: z.number().int().min(0).optional().describe('С какого знака продолжать текст — next_offset из прошлого ответа'),
            text: z.boolean().optional().describe('false — только ссылка, без извлечения текста. По умолчанию true'),
        },
        async ({ file, offset, text }) => {
            const source = String(file).split(':')[0];
            if (FILE_SOURCES[source]) openTable(await getSchema(), key, FILE_SOURCES[source].table);
            return getFile(file, offset ?? 0, text !== false);
        },
    );

    // ── базы знаний ───────────────────────────────────────────────────────────

    tool(
        'list_knowledge_bases',
        'Все базы знаний ОКК: правила и справка консультанта, инструкции по работе в системе, документация проекта, методология Штаба, правила юротдела, знания из разговоров с клиентами, описания продукции, частые вопросы — с рубриками и числом статей. Пример: list_knowledge_bases().',
        {},
        async () => {
            assertSectionOpen(key, 'knowledge');
            return listKnowledgeBases();
        },
    );

    tool(
        'search_knowledge',
        'Поиск статей в базах знаний по словам (не по смыслу: не нашлось — попробуй другое слово или корень). Возвращает статьи с куском текста вокруг найденного. Пример: search_knowledge({query: "дубль заявки"}) или search_knowledge({query: "неустойк", base: "legal_rules"}).',
        {
            query: z.string().describe('Слово или фраза'),
            base: z.string().optional().describe('Код базы из list_knowledge_bases; без него ищем во всех'),
            limit: z.number().int().min(1).max(20).optional().describe('Сколько статей на базу, по умолчанию 8'),
        },
        async ({ query, base, limit }) => {
            assertSectionOpen(key, 'knowledge');
            return searchKnowledge(query, base, limit ?? 8);
        },
    );

    tool(
        'get_article',
        'Статья базы знаний целиком: текст, рубрика, дата обновления. Длинная статья отдаётся частями — продолжение по next_offset. Пример: get_article({id: "okk_consultant:3f2a…"}).',
        {
            id: z.string().describe('Номер статьи вида «база:id» из search_knowledge'),
            offset: z.number().int().min(0).optional().describe('С какого знака продолжать — next_offset из прошлого ответа'),
        },
        async ({ id, offset }) => {
            assertSectionOpen(key, 'knowledge');
            return getArticle(id, offset ?? 0);
        },
    );

    // ── функции ───────────────────────────────────────────────────────────────

    tool(
        'list_functions',
        'Каталог готовых функций ОКК — отчёты и сводки, которые система считает сама: состояние Штаба, факт и воронка продаж, поступления денег, разбор работы отдела продаж, судебные дела, каталог настроек, поиск по коду системы. У каждой — описание и схема параметров. Пример: list_functions({section: "sales"}).',
        { section: z.string().optional().describe('Только функции этого раздела') },
        async ({ section }) => listFunctions(section, key.closedSections),
    );

    tool(
        'run_function',
        'Вызвать функцию из каталога list_functions. Функции только читают: ничего не сохраняют, никому не пишут, во внешние сервисы не ходят. Пример: run_function({name: "sales_facts", params: {months: 3}}).',
        {
            name: z.string().describe('Имя функции из list_functions'),
            params: z.record(z.string(), z.any()).optional().describe('Параметры по схеме функции'),
        },
        async ({ name, params }) => runFunction(name, params ?? {}, key.closedSections),
    );

    // ── аналитика ─────────────────────────────────────────────────────────────

    tool(
        'schema_lookup',
        'Описание таблиц и полей базы ОКК. Передай точное имя таблицы — получишь все её поля с типами, описаниями и связями. Передай слово — получишь таблицы и поля, в имени или описании которых оно встречается. Вызывай перед run_query, чтобы не угадывать имена полей. Пример: schema_lookup({query: "orders"}) или schema_lookup({query: "оплат"}).',
        { query: z.string().describe('Имя таблицы или слово для поиска по именам и описаниям') },
        async ({ query }) => {
            const schema = await getSchema();
            const q = String(query ?? '').trim();
            const exact = schema.tables.get(q.replace(/^public\./i, ''));

            if (exact) {
                assertSectionOpen(key, exact.section);
                return {
                    ...tableBrief(exact),
                    section: exact.section,
                    key_field: exact.pk,
                    fields: exact.columns.map((c) => ({ name: c.name, type: c.type, description: c.comment })),
                    links: linksOf(schema, exact.name),
                    count: exact.columns.length,
                };
            }

            const needle = q.toLowerCase();
            if (needle.length < 2) throw new Error('Слово короче двух знаков.');
            const hit = (text: string | null) => Boolean(text) && text!.toLowerCase().includes(needle);

            const tables = [];
            for (const t of Array.from(schema.tables.values())) {
                if (key.closedSections.includes(t.section)) continue;
                const fields = t.columns.filter((c) => hit(c.name) || hit(c.comment));
                if (!hit(t.name) && !hit(t.comment) && fields.length === 0) continue;
                tables.push({
                    ...tableBrief(t),
                    section: t.section,
                    matched_fields: fields.slice(0, 15).map((c) => ({ name: c.name, type: c.type, description: c.comment })),
                });
                if (tables.length >= 40) break;
            }
            return { query: q, tables, count: tables.length, note: 'Все поля таблицы — schema_lookup с её точным именем.' };
        },
    );

    tool(
        'run_query',
        `Произвольный запрос к базе ОКК (PostgreSQL) для того, чего нет готовым: один SELECT (можно с WITH), без записи и без служебных таблиц базы. В ответе не больше ${MAX_QUERY_ROWS} строк, итоги считай в самом запросе. Диск у базы слабый: всегда ограничивай период, а по order_history_log (миллион строк), widget_* и ai_usage_events — обязательно с условием. Имена полей с заглавными буквами бери в двойные кавычки. Пример: run_query({sql: "select status, count(*) from orders where created_at >= '2026-11-01' group by 1 order by 2 desc"}).`,
        { sql: z.string().describe('Текст одного SELECT') },
        async ({ sql }) => {
            if (key.closedSections.length > 0) {
                const schema = await getSchema();
                for (const name of referencedRelations(sql)) {
                    const table = schema.tables.get(name);
                    if (table) assertSectionOpen(key, table.section);
                }
            }
            return runUserQuery(sql);
        },
    );

    return server;
}
