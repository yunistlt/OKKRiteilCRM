import { describe, expect, it } from 'vitest';
import { inlineText, parseRich } from '@/lib/shtab/rich-parse';

/**
 * Разбор разметки в ответах Тамары.
 *
 * Проверяется на том самом ответе, который вышел нечитаемым: таблица строками
 * из палок и звёздочек. Сломается разбор — числа снова перестанут доходить до
 * владельца, а ради них всё и делалось.
 */

describe('таблица', () => {
    const source = [
        '| Заказ | Сумма | Статус |',
        '|---|---:|---|',
        '| 54784 | **43 600 ₽** | send-assembling |',
        '| 54785 | 12 000 ₽ | prepayed |',
    ].join('\n');

    const table = () => {
        const block = parseRich(source)[0];
        if (block.kind !== 'table') throw new Error(`разобралось как ${block.kind}`);
        return block;
    };

    it('становится таблицей, а не абзацем', () => {
        expect(table().rows).toHaveLength(2);
        expect(table().head).toHaveLength(3);
    });

    it('числовой столбец выравнивается вправо', () => {
        expect(table().align).toEqual(['left', 'right', 'left']);
    });

    it('жирное внутри ячейки становится жирным, а не звёздочками', () => {
        const cell = table().rows[0][1];
        expect(cell[0].kind).toBe('bold');
        expect(inlineText(cell)).toBe('43 600 ₽');
    });
});

describe('остальная разметка', () => {
    it('заголовок отделяется от решёток', () => {
        const b = parseRich('## 5. Ушло в производство')[0];
        expect(b.kind).toBe('heading');
        if (b.kind === 'heading') {
            expect(b.level).toBe(2);
            expect(inlineText(b.content)).toBe('5. Ушло в производство');
        }
    });

    it('код в строке отделяется от текста', () => {
        const b = parseRich('По `order_history_log` статус')[0];
        if (b.kind !== 'paragraph') throw new Error('не абзац');
        expect(b.content.some((n) => n.kind === 'code' && n.text === 'order_history_log')).toBe(true);
    });

    it('разделитель — отдельный блок', () => {
        expect(parseRich('---')[0].kind).toBe('rule');
    });

    it('список собирается в один блок', () => {
        const b = parseRich('- первое\n- второе')[0];
        expect(b.kind).toBe('list');
        if (b.kind === 'list') expect(b.items).toHaveLength(2);
    });

    it('нумерованный список сохраняет номера', () => {
        const b = parseRich('1. раз\n2. два')[0];
        if (b.kind !== 'list') throw new Error('не список');
        expect(b.items.map((i) => i.marker)).toEqual(['1.', '2.']);
    });
});

describe('график', () => {
    it('разбирается в полосы', () => {
        const b = parseRich(
            '```chart\n{"title":"В производство","unit":"шт","data":[{"label":"Ирина","value":5}]}\n```',
        )[0];
        expect(b.kind).toBe('chart');
        if (b.kind === 'chart') {
            expect(b.title).toBe('В производство');
            expect(b.data[0]).toEqual({ label: 'Ирина', value: 5 });
        }
    });

    // Пропав молча, сломанный график оставит владельца в уверенности, что
    // данных не было.
    it('сломанный остаётся видимым', () => {
        const b = parseRich('```chart\n{это не json}\n```')[0];
        expect(b.kind).toBe('pre');
        if (b.kind === 'pre') expect(b.text).toContain('это не json');
    });

    it('пустой график не рисуется полосами', () => {
        expect(parseRich('```chart\n{"data":[]}\n```')[0].kind).toBe('pre');
    });
});
