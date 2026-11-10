/**
 * Коннектор Claude к ОКК: рубежи «только чтение» и разбор параметров.
 *
 * Базу тесты не трогают — проверяется то, что решает код: какой запрос пройдёт
 * проверку, какие функции попадают в каталог, как собирается условие.
 * Проверка на живых данных — scripts/mcp-smoke.ts.
 */
import { describe, it, expect } from 'vitest';
import { assertQueryAllowed, fitRows, ident, lit } from '@/lib/mcp/sql';
import { sectionOf } from '@/lib/mcp/schema';
import type { Section, Table } from '@/lib/mcp/schema';
import { filterSql, limitOf, offsetOf, whereSql, MAX_LIMIT, DEFAULT_LIMIT } from '@/lib/mcp/entities';
import { NEVER_VIA_CONNECTOR, READ_ONLY_FUNCTIONS, listFunctions, runFunction } from '@/lib/mcp/functions';
import { parseFileRef } from '@/lib/mcp/files';
import { fragment } from '@/lib/mcp/search';
import { generateKey, hashKey, keyFromRequest } from '@/lib/mcp/keys';
import { SHTAB_TOOL_NAMES } from '@/lib/shtab/tamara-tools';

describe('run_query: что проходит проверку', () => {
    it('пропускает SELECT и WITH по нашим таблицам', () => {
        expect(() => assertQueryAllowed('select * from orders limit 5')).not.toThrow();
        expect(() => assertQueryAllowed('with x as (select id from orders) select count(*) from x')).not.toThrow();
        expect(() => assertQueryAllowed('select o.id from public.orders o join managers m on m.id = o.manager_id')).not.toThrow();
        expect(() => assertQueryAllowed("select column_name from information_schema.columns where table_name = 'orders'")).not.toThrow();
    });

    it('слова updated_at и created_at в запросе — не запись', () => {
        expect(() => assertQueryAllowed('select updated_at, created_at from orders')).not.toThrow();
    });

    it.each([
        ["insert into orders(id) values (1)"],
        ['update orders set status = 1'],
        ['delete from orders'],
        ['drop table orders'],
        ['alter table orders add column x int'],
        ['truncate orders'],
        ['create table x (id int)'],
        ['grant all on orders to public'],
        ['select 1; select 2'],
        ['select 1; delete from orders'],
        ["with x as (insert into orders(id) values (1) returning id) select * from x"],
        ['select * from orders for update'],
    ])('отклоняет запись и цепочки: %s', (sql) => {
        expect(() => assertQueryAllowed(sql)).toThrow();
    });

    it.each([
        ['select * from pg_shadow'],
        ['select * from pg_catalog.pg_authid'],
        ['select * from auth.users'],
        ['select * from storage.objects'],
        ['select * from vault.secrets'],
        ['select * from information_schema.role_table_grants'],
    ])('отклоняет служебные таблицы и чужие схемы: %s', (sql) => {
        expect(() => assertQueryAllowed(sql)).toThrow(/служебная таблица/);
    });

    it('ошибка не упоминает «внешнюю базу» — база наша', () => {
        expect(() => assertQueryAllowed('delete from orders')).toThrow(/^Разрешён только SELECT/);
    });
});

describe('сборка запроса из параметров', () => {
    const table: Table = {
        name: 'orders',
        kind: 'table',
        comment: null,
        rows: 10,
        pk: 'id',
        section: 'orders',
        columns: [
            { name: 'id', type: 'bigint', comment: null },
            { name: 'number', type: 'text', comment: null },
            { name: 'createdAt', type: 'timestamp with time zone', comment: null },
        ],
    };

    it('значение уходит литералом, кавычка в нём удваивается', () => {
        expect(filterSql(table, { field: 'number', value: "1'; drop table x; --" })).toBe(`"number" = '1''; drop table x; --'`);
        expect(lit("O'Brien")).toBe("'O''Brien'");
    });

    it('число сравнивается в кавычках — база приводит его к типу колонки', () => {
        expect(filterSql(table, { field: 'id', op: 'gt', value: 5 })).toBe(`"id" > '5'`);
    });

    it('имя поля с заглавными буквами берётся в кавычки', () => {
        expect(filterSql(table, { field: 'createdAt', op: 'not_null' })).toBe('"createdAt" IS NOT NULL');
        expect(ident('a"b')).toBe('"a""b"');
    });

    it('неизвестное поле и неизвестное сравнение — отказ, а не запрос', () => {
        expect(() => filterSql(table, { field: 'id; drop table x', value: 1 })).toThrow(/нет поля/);
        expect(() => filterSql(table, { field: 'id', op: 'regexp', value: 1 })).toThrow(/Неизвестное сравнение/);
    });

    it('период и фильтры складываются через AND', () => {
        expect(whereSql(table, [{ field: 'id', op: 'in', value: [1, 2] }], { field: 'createdAt', from: '2026-11-01' }))
            .toBe(`WHERE "id" IN ('1', '2') AND "createdAt" >= '2026-11-01'`);
        expect(whereSql(table)).toBe('');
    });

    it('limit и cursor держатся в границах', () => {
        expect(limitOf(undefined)).toBe(DEFAULT_LIMIT);
        expect(limitOf(100000)).toBe(MAX_LIMIT);
        expect(limitOf(-3)).toBe(DEFAULT_LIMIT);
        expect(offsetOf('50')).toBe(50);
        expect(offsetOf('-1')).toBe(0);
        expect(offsetOf('abc')).toBe(0);
    });

    it('ответ режется по размеру, но первая строка остаётся всегда', () => {
        const rows = Array.from({ length: 100 }, (_, i) => ({ i, text: 'x'.repeat(1000) }));
        const fitted = fitRows(rows, 5000);
        expect(fitted.cut).toBe(true);
        expect(fitted.rows.length).toBeGreaterThan(0);
        expect(fitted.rows.length).toBeLessThan(6);
        expect(fitRows([{ big: 'x'.repeat(10_000) }], 5000).rows.length).toBe(1);
    });
});

describe('реестр разделов', () => {
    const sections: Section[] = [
        { key: 'orders', title: '', description: '', tables: ['orders', 'clients'], prefixes: ['order_'], links: [] },
        { key: 'mail', title: '', description: '', tables: [], prefixes: ['order_mail_', 'email_'], links: [] },
        { key: 'okk', title: '', description: '', tables: [], prefixes: ['okk_'], links: [] },
        { key: 'knowledge', title: '', description: '', tables: ['okk_consultant_knowledge'], prefixes: [], links: [] },
    ];

    it('точное имя сильнее начала имени', () => {
        expect(sectionOf('okk_consultant_knowledge', sections)).toBe('knowledge');
        expect(sectionOf('okk_rules', sections)).toBe('okk');
    });

    it('из двух подходящих начал побеждает длинное', () => {
        expect(sectionOf('order_mail_threads', sections)).toBe('mail');
        expect(sectionOf('order_items', sections)).toBe('orders');
    });

    it('новая таблица без строки в реестре видна в «Прочем»', () => {
        expect(sectionOf('brand_new_table', sections)).toBe('other');
    });
});

describe('каталог функций — только чтение', () => {
    it('в каталоге нет ни одной функции, которая пишет, отправляет или тратит деньги', () => {
        for (const name of NEVER_VIA_CONNECTOR) expect(READ_ONLY_FUNCTIONS[name]).toBeUndefined();
    });

    it('каждая функция каталога существует у Тамары', () => {
        for (const name of Object.keys(READ_ONLY_FUNCTIONS)) expect(SHTAB_TOOL_NAMES.has(name)).toBe(true);
    });

    it('list_functions отдаёт описание и схему параметров, закрытый раздел скрывает', () => {
        const all = listFunctions();
        expect(all.count).toBe(Object.keys(READ_ONLY_FUNCTIONS).length);
        expect(all.functions.every((f) => f.description && f.parameters)).toBe(true);
        expect(listFunctions(undefined, ['shtab']).functions.some((f) => f.section === 'shtab')).toBe(false);
    });

    it('функция не из каталога не вызывается', async () => {
        await expect(runFunction('telegram_owner', { text: 'x' })).rejects.toThrow(/в каталоге нет/);
        await expect(runFunction('shtab_razbor_write', {})).rejects.toThrow(/в каталоге нет/);
        await expect(runFunction('shtab_state', {}, ['shtab'])).rejects.toThrow(/в каталоге нет/);
    });
});

describe('файлы, поиск, ключи', () => {
    it('файл называется «источник:номер»', () => {
        expect(parseFileRef('order_files:123')).toEqual({ source: 'order_files', id: '123' });
        expect(parseFileRef('storage:okk-assets/a/b.pdf')).toEqual({ source: 'storage', id: 'okk-assets/a/b.pdf' });
        expect(() => parseFileRef('123')).toThrow();
        expect(() => parseFileRef('order_files:')).toThrow();
    });

    it('кусок текста берётся вокруг найденного слова, кириллица не мешает', () => {
        const text = `${'а'.repeat(500)} Газпром ${'б'.repeat(500)}`;
        const piece = fragment(text, 'газпром', 20);
        expect(piece).toContain('Газпром');
        expect(piece.length).toBeLessThan(60);
        expect(piece.startsWith('…')).toBe(true);
    });

    it('ключ принимается и заголовком X-Api-Key, и как Bearer', () => {
        expect(keyFromRequest(new Request('http://x', { headers: { 'X-Api-Key': ' okk_abc ' } }))).toBe('okk_abc');
        expect(keyFromRequest(new Request('http://x', { headers: { Authorization: 'Bearer okk_abc' } }))).toBe('okk_abc');
        expect(keyFromRequest(new Request('http://x'))).toBe('');
    });

    it('в базе лежит хеш, а не ключ; ключи не повторяются', () => {
        const a = generateKey();
        const b = generateKey();
        expect(a).not.toBe(b);
        expect(a.startsWith('okk_')).toBe(true);
        expect(hashKey(a)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashKey(a)).not.toContain(a.slice(4, 12));
        expect(hashKey(` ${a} `)).toBe(hashKey(a));
    });
});
