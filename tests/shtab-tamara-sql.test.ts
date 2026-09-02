import { describe, expect, it } from 'vitest';
import { assertAllowedQuery, cteNames, referencedRelations, withLimit } from '@/lib/shtab/tamara-sql';

// Право Тамары писать запросы самой. Проверяется то, что отделяет разбор от
// происшествия: читать можно только разрешённое, писать нельзя вовсе.

describe('что Тамаре разрешено читать', () => {
    it('обычный запрос по разрешённой таблице проходит', () => {
        expect(() => assertAllowedQuery('SELECT count(*) FROM orders WHERE status = $$new$$')).not.toThrow();
        expect(() => assertAllowedQuery('select o.number from public.orders o join statuses s on s.code = o.status')).not.toThrow();
    });

    it('чужая таблица не проходит, и в ошибке сказано какая', () => {
        expect(() => assertAllowedQuery('SELECT * FROM messenger_push_delivery_logs')).toThrow(/messenger_push/);
        expect(() => assertAllowedQuery('SELECT * FROM auth.users')).toThrow();
    });

    it('временные имена из WITH таблицами не считаются', () => {
        expect(() =>
            assertAllowedQuery('WITH sold AS (SELECT order_id FROM orders) SELECT count(*) FROM sold'),
        ).not.toThrow();
    });

    it('запись не проходит ни в каком виде', () => {
        expect(() => assertAllowedQuery('UPDATE orders SET status = 1')).toThrow();
        expect(() => assertAllowedQuery('SELECT 1; DROP TABLE orders')).toThrow();
        // Пишущий CTE начинается со слова WITH и точки с запятой не содержит —
        // ровно тот случай, ради которого проверка и написана.
        expect(() => assertAllowedQuery('WITH x AS (INSERT INTO orders DEFAULT VALUES RETURNING id) SELECT * FROM x')).toThrow();
    });

    it('блокировки запрещены — чужая боевая база не должна встать', () => {
        expect(() => assertAllowedQuery('SELECT * FROM orders FOR UPDATE')).toThrow(/Блокировки/);
    });
});

describe('разбор запроса', () => {
    it('находит таблицы после FROM и JOIN', () => {
        const rel = referencedRelations('SELECT * FROM orders o LEFT JOIN managers m ON m.id = o.manager_id');
        expect(rel).toEqual(['orders', 'managers']);
    });

    it('видит имена, объявленные в WITH', () => {
        expect(cteNames('WITH sold AS (SELECT 1), paid AS (SELECT 2) SELECT 1')).toEqual(['sold', 'paid']);
    });
});

describe('ограничение выдачи', () => {
    it('лимит дописывается, если его нет', () => {
        expect(withLimit('SELECT * FROM orders')).toBe('SELECT * FROM orders LIMIT 200');
    });

    it('свой лимит не трогаем', () => {
        expect(withLimit('SELECT * FROM orders LIMIT 5')).toBe('SELECT * FROM orders LIMIT 5');
    });

    it('хвостовая точка с запятой не мешает', () => {
        expect(withLimit('SELECT 1;')).toBe('SELECT 1 LIMIT 200');
    });
});
