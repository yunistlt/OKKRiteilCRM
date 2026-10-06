/**
 * Поиск заказа по покупателю: телефон и карточка клиента.
 *
 * Жалобы менеджеров 06.10.2026: заказ не находится ни по номеру телефона
 * (Ирина Гордеева), ни по фамилии клиента (Евгения Матвеева). Проверяем, что
 * условие запроса покрывает оба случая.
 */
import { describe, it, expect } from 'vitest';
import { applyOrdersFilter, EMPTY_FILTER } from '../lib/orders-filter';

/** Заглушка запроса: запоминает, какие условия на него навесили. */
function fakeQuery() {
    const conditions: string[] = [];
    const q: any = {
        or: (c: string) => { conditions.push(c); return q; },
        ilike: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q,
        not: () => q, is: () => q, filter: () => q, contains: () => q, overlaps: () => q,
        conditions,
    };
    return q;
}

describe('фильтр «Покупатель»', () => {
    it('ищет телефон по последним десяти цифрам, как бы его ни записали', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, customer: '+7 (390) 443-11-57' });
        const where = q.conditions.join('|');

        expect(where).toContain('3904431157');
    });

    it('смотрит телефон и внутри заказа, не только в колонке', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, customer: '79581001285' });
        const where = q.conditions.join('|');

        // Колонку заполняет перенос из RetailCRM, свои заказы её не знали.
        expect(where).toContain('raw_payload->>phone');
        expect(where).toContain('phone.ilike');
    });

    it('ищет по найденным карточкам клиентов, а не только по контакту заказа', () => {
        const q = applyOrdersFilter(fakeQuery(), {
            ...EMPTY_FILTER, customer: 'Лачинов', customerIds: ['76464', '900000034'],
        });
        const where = q.conditions.join('|');

        expect(where).toContain('raw_payload->customer->>id.in.(76464,900000034)');
    });

    it('без найденных карточек ищет по полям самого заказа', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, customer: 'Иванов' });
        const where = q.conditions.join('|');

        expect(where).toContain('raw_payload->>lastName');
        expect(where).not.toContain('raw_payload->customer->>id.in');
    });
});
