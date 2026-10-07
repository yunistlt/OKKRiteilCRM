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
    const calls: unknown[][] = [];
    const note = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return q; };
    const q: any = {
        or: (c: string) => { conditions.push(c); return q; },
        ilike: note('ilike'), eq: note('eq'), in: note('in'), gte: note('gte'), lte: note('lte'),
        not: note('not'), is: note('is'), filter: note('filter'), contains: note('contains'),
        overlaps: note('overlaps'),
        conditions, calls,
    };
    return q;
}

describe('фильтр «Покупатель»', () => {
    it('ищет телефон по последним десяти цифрам, как бы его ни записали', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, customer: '+7 (390) 443-11-57' });
        const where = q.conditions.join('|');

        expect(where).toContain('3904431157');
    });

    it('ищет по полям заказа, а не по снимку', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, customer: '79581001285' });
        const where = q.conditions.join('|');

        // Снимок в условие не попадает: разбор JSON по 30 тысячам строк без
        // индексов не укладывался в таймаут, и поиск отвечал «заказов нет»
        // (жалоба Ксении 07.10.2026).
        expect(where).not.toContain('raw_payload');
        // Всё, по чему ищут покупателя, сложено в одно поле: по одному полю
        // поиск 121 мс, через ИЛИ по семи — 2 061 мс (замер 07.10.2026).
        expect(where).toContain('search_text.ilike.%79581001285%');
        // И по последним цифрам: номер набирают по-разному.
        expect(where).toContain('search_text.ilike.%9581001285%');
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

        expect(where).toContain('search_text.ilike.%иванов%');
        expect(where).not.toContain('raw_payload->customer->>id.in');
    });
});

describe('фильтр «Только возможные дубли»', () => {
    it('показывает только присланных базой кандидатов', () => {
        const q = applyOrdersFilter(fakeQuery(), {
            ...EMPTY_FILTER, duplicatesOnly: true, duplicateIds: ['54912', '54905'],
        });

        expect(q.calls).toContainEqual(['in', 'order_id', ['54912', '54905']]);
    });

    it('без кандидатов показывает пустую таблицу, а не весь список', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, duplicatesOnly: true, duplicateIds: [] });

        expect(q.calls).toContainEqual(['eq', 'order_id', -1]);
    });
});

describe('фильтр «Наименование товара»', () => {
    it('ищет по названиям позиций заказа', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, itemName: 'стеллаж' });

        expect(q.calls).toContainEqual(['ilike', 'items_text', '%стеллаж%']);
    });

    it('знаки препинания в названии не мешают', () => {
        // «Стеллаж СТ-15» и «Стеллаж СТ–15» — один и тот же товар.
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, itemName: 'стеллаж СТ-15' });

        expect(q.calls).toContainEqual(['ilike', 'items_text', '%стеллаж%СТ%15%']);
    });

    it('пустое значение условие не добавляет', () => {
        const q = applyOrdersFilter(fakeQuery(), { ...EMPTY_FILTER, itemName: '   ' });

        expect(q.calls.filter((c) => c[1] === 'items_text')).toHaveLength(0);
    });
});
