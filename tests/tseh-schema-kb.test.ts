/**
 * Схема ЦехУспеха в знаниях Тамары.
 *
 * Регрессия, ради которой всё это сделано: на один вопрос про заказы недели
 * уходило 26 вызовов инструментов, и 18 из них были разведкой строения базы —
 * какие таблицы, какие колонки. Каждый вопрос заново, и каждый ответ
 * information_schema потом ехал к модели на всех оставшихся витках разбора.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildSchemaArticles, formatArticleForEmbedding, SCHEMA_SLUG_PREFIX, type TsehTable } from '@/lib/shtab/tseh-schema-kb';
import { kbFingerprint } from '@/lib/shtab/kb-seed';

function table(name: string, cols: string[]): TsehTable {
    return {
        table: name,
        columns: cols.map((c) => ({ table: name, column: c, type: 'int', nullable: false, key: '', comment: '' })),
    };
}

const SAMPLE: TsehTable[] = [
    table('orders', ['ID', 'NumberSourceOrder', 'PlanDateReadyDelivery']),
    table('itemsorders', ['ID', 'IDOrder', 'TotalPriceFact']),
    table('billsfromsuppliers', ['ID', 'IDSupplier']),
    table('itemsordersbillsfromsuppliers', ['ID', 'IDBill']),
    table('employees', ['ID', 'FIO']),
    table('texcards', ['ID', 'IDDetail']),
    table('payments', ['ID', 'Summa']),
    table('saleswb', ['ID']),
    table('docslib', ['ID']),
    table('somethingelse', ['ID']),
];

describe('нарезка схемы на статьи', () => {
    const articles = buildSchemaArticles(SAMPLE);

    it('каждая таблица попадает ровно в одну статью — иначе за неё платим дважды', () => {
        const groups = articles.filter((a) => !a.slug.endsWith('spisok'));
        for (const t of SAMPLE) {
            const hits = groups.filter((a) => new RegExp(`(^|\\n)${t.table}:`).test(a.content));
            expect(hits.length, `таблица ${t.table} в ${hits.length} статьях`).toBe(1);
        }
    });

    it('счета поставщиков не попадают к заказам, хотя в имени есть order', () => {
        const zakazy = articles.find((a) => a.slug === `${SCHEMA_SLUG_PREFIX}zakazy`)!;
        expect(zakazy.content).toMatch(/(^|\n)orders:/);
        expect(zakazy.content).not.toMatch(/(^|\n)itemsordersbillsfromsuppliers:/);
    });

    it('полный список таблиц есть отдельной статьёй — на случай, когда группа не нашлась', () => {
        const list = articles.find((a) => a.slug === `${SCHEMA_SLUG_PREFIX}spisok`);
        expect(list).toBeDefined();
        for (const t of SAMPLE) expect(list!.content).toContain(t.table);
    });

    it('статей немного: поиск отдаёт в контекст всего четыре', () => {
        expect(articles.length).toBeLessThanOrEqual(10);
    });

    // Техкарты в базе называются texcards, а не techcards. На этом уже
    // погорели: ядро производства уезжало в «прочее», где лежала половина базы.
    it('техкарты попадают к производству, а не в «прочее»', () => {
        const prod = articles.find((a) => a.slug === `${SCHEMA_SLUG_PREFIX}proizvodstvo`)!;
        expect(prod.content).toMatch(/(^|\n)texcards:/);
    });

    it('деньги, продажи и документы разведены по своим статьям', () => {
        const at = (key: string) => articles.find((a) => a.slug === `${SCHEMA_SLUG_PREFIX}${key}`)!.content;
        expect(at('dengi')).toMatch(/(^|\n)payments:/);
        expect(at('prodazhi')).toMatch(/(^|\n)saleswb:/);
        expect(at('dokumenty')).toMatch(/(^|\n)docslib:/);
    });

    // Четыре статьи разом едут в контекст и потом на каждом витке разбора.
    // Статья на восемь тысяч токенов — это ровно та цена, от которой уходим.
    it('ни одна статья не разрастается: в живой базе самая большая около 3 тысяч токенов', () => {
        for (const a of articles) {
            const roughTokens = formatArticleForEmbedding(a).length / 3.3;
            expect(roughTokens, `статья ${a.slug}`).toBeLessThan(4000);
        }
    });

    it('каждая статья говорит не ходить за схемой запросами', () => {
        for (const a of articles) expect(a.content).toContain('information_schema');
    });

    it('колонки таблицы видны в тексте — иначе статья бесполезна', () => {
        const zakazy = articles.find((a) => a.slug === `${SCHEMA_SLUG_PREFIX}zakazy`)!;
        expect(zakazy.content).toContain('PlanDateReadyDelivery');
        expect(zakazy.content).toContain('TotalPriceFact');
    });
});

describe('отпечаток решает, платить ли за эмбеддинг', () => {
    it('та же схема — тот же отпечаток, пересчёта не будет', () => {
        const a = buildSchemaArticles(SAMPLE).map((x) => kbFingerprint(formatArticleForEmbedding(x)));
        const b = buildSchemaArticles([...SAMPLE].reverse()).map((x) => kbFingerprint(formatArticleForEmbedding(x)));
        expect(a).toEqual(b);
    });

    it('новая колонка меняет отпечаток своей статьи — снимок обновится', () => {
        const before = buildSchemaArticles(SAMPLE);
        const after = buildSchemaArticles([
            ...SAMPLE.filter((t) => t.table !== 'orders'),
            table('orders', ['ID', 'NumberSourceOrder', 'PlanDateReadyDelivery', 'NewColumn']),
        ]);
        const fp = (list: ReturnType<typeof buildSchemaArticles>, slug: string) =>
            kbFingerprint(formatArticleForEmbedding(list.find((a) => a.slug === slug)!));

        expect(fp(before, `${SCHEMA_SLUG_PREFIX}zakazy`)).not.toBe(fp(after, `${SCHEMA_SLUG_PREFIX}zakazy`));
        // А не относящаяся к заказам часть не трогается — за неё платить незачем.
        expect(fp(before, `${SCHEMA_SLUG_PREFIX}lyudi`)).toBe(fp(after, `${SCHEMA_SLUG_PREFIX}lyudi`));
    });
});

describe('снимок и рукописные знания не мешают друг другу', () => {
    const seedSource = fs.readFileSync(path.join(process.cwd(), 'lib/shtab/kb-seed.ts'), 'utf8');

    it('обычный засев не гасит статьи схемы — иначе наутро их бы не стало', () => {
        expect(seedSource).toContain('NOT LIKE');
        expect(seedSource).toContain('SCHEMA_SLUG_PREFIX');
    });
});

describe('схема едет своей квотой, а не в общей очереди знаний', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/shtab/tamara.ts'), 'utf8');

    // Замер 30.09.2026: в общей очереди схема встала шестой (0.419) после
    // четырёх методичек (0.482…0.444) и до модели не доехала вовсе.
    it('поиск знаний исключает схему, а схему ищет отдельно', () => {
        expect(source).toContain('exclude_types: [SCHEMA_TYPE]');
        expect(source).toContain('want_types: [SCHEMA_TYPE]');
    });

    it('эмбеддинг считается один на оба поиска — за каждый вызов платим', () => {
        expect((source.match(/await generateEmbedding\(query\)/g) ?? []).length).toBe(1);
    });

    it('схема идёт впереди знаний: чем писать запрос, читается раньше рассуждений', () => {
        expect(source).toMatch(/\[\.\.\.\(\(schema\.data[\s\S]{0,120}knowledge\.data/);
    });
});

describe('модель больше не отправляется в разведку', () => {
    const tools = fs.readFileSync(path.join(process.cwd(), 'lib/shtab/tamara-data-tools.ts'), 'utf8');
    const kb = fs.readFileSync(path.join(process.cwd(), 'lib/shtab/kb-content.ts'), 'utf8');

    it('описание tseh_query не зовёт выяснять таблицы', () => {
        expect(tools).not.toContain('Не знаешь таблиц — вызови tseh_tables');
    });

    it('и знания, и описание инструмента отсылают к снимку схемы', () => {
        expect(tools).toContain('в знаниях');
        expect(kb).toContain('Строение базы выяснять запросами НЕ НУЖНО');
    });
});
