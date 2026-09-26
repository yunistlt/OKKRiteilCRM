import { describe, it, expect } from 'vitest';
import { formatToolResult } from '@/lib/shtab/tool-format';

describe('подача ответов инструментов Тамаре', () => {
    it('выборку подаёт таблицей: шапка один раз, строки следом', () => {
        const out = formatToolResult({
            rows: [
                { status: 'new', orders: 12, sum_total: '1234567.890000001' },
                { status: 'done', orders: 3, sum_total: '42.5' },
            ],
            rowCount: 2,
        });
        expect(out).toContain('status|orders|sum_total');
        expect(out).toContain('new|12|1234567.89');
        expect(out).toContain('rowCount: 2');
        // имена полей не повторяются на каждой строке
        expect(out.match(/status/g)).toHaveLength(1);
    });

    it('не теряет ни строк, ни предупреждения об обрезке', () => {
        const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `стр ${i}` }));
        const out = formatToolResult({ rows, rowCount: 200, note: 'Показаны первые 200 строк' });
        expect(out.split('\n').filter((l) => /^\d+\|/.test(l))).toHaveLength(200);
        expect(out).toContain('Показаны первые 200 строк');
        expect(out).toContain('id|name');
    });

    it('целые числа и короткие дроби оставляет как есть', () => {
        const out = formatToolResult({ rows: [{ a: 7, b: '42.5', c: 0 }] });
        expect(out).toContain('7|42.5|0');
    });

    it('разнородные записи таблицей не подаёт — колонки разъехались бы', () => {
        const out = formatToolResult({ rows: [{ a: 1 }, { b: 2 }] });
        expect(out).toContain('"a":1');
        expect(out).toContain('"b":2');
    });

    it('пустую выборку и ошибку доносит дословно', () => {
        expect(formatToolResult({ error: 'Запрос не выполнился: нет такой колонки' }))
            .toContain('нет такой колонки');
        expect(formatToolResult({ rows: [], rowCount: 0 })).toContain('"rowCount":0');
    });

    it('на реальной выдаче короче JSON как минимум на треть', () => {
        const rows = Array.from({ length: 50 }, (_, i) => ({
            order_number: 50000 + i,
            status: 'v-proscete',
            manager_name: 'Иванов Иван',
            total_sum: `${100000 + i}.120000000001`,
            created_at: '2026-09-26T10:00:00.000Z',
        }));
        const asJson = JSON.stringify({ rows, rowCount: rows.length });
        const compact = formatToolResult({ rows, rowCount: rows.length });
        expect(compact.length).toBeLessThan(asJson.length * 0.67);
    });
});
