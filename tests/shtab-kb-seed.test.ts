import { describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import { SCHEMA_SLUG_PREFIX, kbFingerprint, seedShtabKb } from '@/lib/shtab/kb-seed';
import { SHTAB_KB_SEED, formatShtabKbForEmbedding } from '@/lib/shtab/kb-content';

// Подставная база: засев делает ровно четыре вида запросов, и для проверки
// поведения этого достаточно. Живой Postgres здесь не нужен, а эмбеддинги
// считает счётчик вызовов — платит за них в проде OpenAI, и важно видеть, что
// лишних вызовов нет.
type Row = { slug: string; fp: string | null; isActive: boolean };

function fakeSql(rows: Row[]) {
    const table = new Map(rows.map((r) => [r.slug, { ...r }]));
    const calls: string[] = [];

    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(' ').replace(/\s+/g, ' ').trim();
        calls.push(query);

        if (query.startsWith('SELECT slug')) {
            return Promise.resolve([...table.values()]);
        }
        if (query.startsWith('UPDATE public.shtab_kb SET is_active = true')) {
            const slug = values[0] as string;
            table.get(slug)!.isActive = true;
            return Promise.resolve([]);
        }
        if (query.startsWith('INSERT INTO public.shtab_kb')) {
            const [slug, , , , , , fp] = values as [string, string, string, string, string[], string, string];
            table.set(slug, { slug, fp, isActive: true });
            return Promise.resolve([]);
        }
        if (query.startsWith('UPDATE public.shtab_kb SET is_active = false')) {
            const keep = new Set(values[0] as string[]);
            const off: { slug: string }[] = [];
            for (const row of table.values()) {
                if (row.isActive && !keep.has(row.slug) && !row.slug.startsWith(SCHEMA_SLUG_PREFIX)) {
                    row.isActive = false;
                    off.push({ slug: row.slug });
                }
            }
            return Promise.resolve(off);
        }
        throw new Error(`неожиданный запрос: ${query}`);
    };

    return { sql: sql as unknown as Sql, table, calls };
}

/** Строки базы в том виде, в каком их оставил бы успешный засев. */
const actualRows = (): Row[] =>
    SHTAB_KB_SEED.map((row) => ({
        slug: row.slug,
        fp: kbFingerprint(formatShtabKbForEmbedding(row)),
        isActive: true,
    }));

describe('засев знаний Тамары', () => {
    it('возвращает погашенные статьи, не пересчитывая эмбеддинги', async () => {
        // Засев, запущенный из каталога с устаревшим kb-content.ts, погасил в
        // боевой базе 51 статью. Повторный запуск с правильным содержанием
        // объявлял их «без изменений» и оставлял выключенными — Тамара молчала
        // по всему БТР. Отпечаток совпал, значит эмбеддинг в строке верный:
        // статью надо включить обратно и ничего не платить.
        const rows = actualRows();
        const off = rows.slice(0, 3);
        for (const row of off) row.isActive = false;

        const { sql, table } = fakeSql(rows);
        let embedCalls = 0;
        const report = await seedShtabKb(sql, async () => {
            embedCalls += 1;
            return [0.1];
        });

        expect(report.revived).toEqual(off.map((r) => r.slug));
        expect(report.unchanged.length).toBe(rows.length - off.length);
        expect(embedCalls).toBe(0);
        for (const row of off) expect(table.get(row.slug)!.isActive, row.slug).toBe(true);
    });

    it('активные статьи с тем же текстом не трогает', async () => {
        const { sql, calls } = fakeSql(actualRows());
        const report = await seedShtabKb(sql, async () => [0.1]);

        expect(report.revived).toEqual([]);
        expect(report.inserted).toEqual([]);
        expect(report.updated).toEqual([]);
        expect(report.unchanged.length).toBe(SHTAB_KB_SEED.length);
        expect(calls.some((q) => q.startsWith('UPDATE public.shtab_kb SET is_active = true'))).toBe(false);
    });

    it('новую статью добавляет и считает ей эмбеддинг один раз', async () => {
        const rows = actualRows();
        const added = rows.pop()!;

        const { sql, table } = fakeSql(rows);
        let embedCalls = 0;
        const report = await seedShtabKb(sql, async () => {
            embedCalls += 1;
            return [0.1];
        });

        expect(report.inserted).toEqual([added.slug]);
        expect(embedCalls).toBe(1);
        expect(table.get(added.slug)!.isActive).toBe(true);
    });

    it('снимок схемы завода не гасит: его пишет не kb-content, а ночной крон', async () => {
        const rows = actualRows();
        rows.push({ slug: `${SCHEMA_SLUG_PREFIX}zakazy`, fp: 'снимок', isActive: true });

        const { sql, table } = fakeSql(rows);
        const report = await seedShtabKb(sql, async () => [0.1]);

        expect(report.deactivated).toEqual([]);
        expect(table.get(`${SCHEMA_SLUG_PREFIX}zakazy`)!.isActive).toBe(true);
    });

    it('статью, выброшенную из kb-content, гасит', async () => {
        const rows = actualRows();
        rows.push({ slug: 'as-staraya-statya', fp: 'старая', isActive: true });

        const { sql } = fakeSql(rows);
        const report = await seedShtabKb(sql, async () => [0.1]);

        expect(report.deactivated).toEqual(['as-staraya-statya']);
    });
});
