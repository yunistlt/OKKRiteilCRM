import { describe, it, expect } from 'vitest';
import { applyOrdersFilter, EMPTY_FILTER, filterToCountParams } from '@/lib/orders-filter';

/**
 * Фильтр списка заказов по датам. Через JSON (`raw_payload->customFields->>…`)
 * PostgREST отказывался сравнивать даты, запрос падал с пустой ошибкой, и
 * список молча оставался прежним (поймано 02.10.2026). Теперь — колонки.
 */

/** Заглушка запроса: записывает, на какие поля навесили условия. */
function fakeQuery() {
    const calls: Array<{ op: string; column: string; value: unknown }> = [];
    const q: any = {};
    for (const op of ['gte', 'lte', 'eq', 'in', 'ilike', 'or', 'is']) {
        q[op] = (column: string, value: unknown) => {
            calls.push({ op, column, value });
            return q;
        };
    }
    return { q, calls };
}

describe('фильтр заказов по датам', () => {
    it('дата следующего контакта сравнивается по колонке, а не по JSON', () => {
        const { q, calls } = fakeQuery();
        applyOrdersFilter(q, { ...EMPTY_FILTER, contactFrom: '2026-10-01', contactTo: '2026-10-31' });

        expect(calls).toEqual([
            { op: 'gte', column: 'data_kontakta', value: '2026-10-01' },
            { op: 'lte', column: 'data_kontakta', value: '2026-10-31' },
        ]);
        expect(JSON.stringify(calls)).not.toContain('customFields');
    });

    it('месяц закупки — тоже колонка (имя укорочено Postgres до 63 знаков)', () => {
        const { q, calls } = fakeQuery();
        applyOrdersFilter(q, { ...EMPTY_FILTER, purchaseFrom: '2026-11-01' });

        expect(calls[0].column).toBe('kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_dat');
        expect(calls[0].column.length).toBeLessThanOrEqual(63);
    });

    it('КОНТРОЛЬ сравнивается с настоящим булевым значением', () => {
        const yes = fakeQuery();
        applyOrdersFilter(yes.q, { ...EMPTY_FILTER, control: 'yes' });
        expect(yes.calls).toEqual([{ op: 'eq', column: 'control', value: true }]);

        const no = fakeQuery();
        applyOrdersFilter(no.q, { ...EMPTY_FILTER, control: 'no' });
        expect(no.calls).toEqual([{ op: 'eq', column: 'control', value: false }]);
    });

    it('смещение «неделю назад» разворачивается в дату на момент запроса', () => {
        const { q, calls } = fakeQuery();
        applyOrdersFilter(q, { ...EMPTY_FILTER, contactFrom: 'rel:-7d' });

        expect(calls[0].column).toBe('data_kontakta');
        expect(String(calls[0].value)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(String(calls[0].value)).not.toContain('rel:');
    });

    it('в параметры «Итого по фильтру» уходят выбранные статусы', () => {
        const params = filterToCountParams({ ...EMPTY_FILTER, statuses: ['novyi-1', 'otlozeno'] }, []);
        expect(params.statuses).toEqual(['novyi-1', 'otlozeno']);
    });
});
