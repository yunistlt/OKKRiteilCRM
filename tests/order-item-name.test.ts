import { describe, expect, it } from 'vitest';
import { collapseDoubledName, itemNameWithVariant } from '@/lib/own-crm/item-name';

/**
 * Склейка названия товара с модификацией. Живые случаи из каталога сайта:
 * у модификации там часто стоит полное имя товара, и наивная склейка давала
 * «X X» в счёте, договоре и спецификации (заказ 900072).
 */
describe('название позиции с модификацией', () => {
    it('не повторяет товар, когда модификация названа так же', () => {
        const name = 'Сушильный шкаф для одежды и обуви ШС-4/1 (1900х1200х620 мм)';
        expect(itemNameWithVariant(name, name)).toBe(name);
    });

    it('схлопывает «Доставка Доставка»', () => {
        expect(itemNameWithVariant('Доставка', 'Доставка')).toBe('Доставка');
    });

    it('берёт модификацию целиком, если в ней есть имя товара', () => {
        expect(itemNameWithVariant('Шкаф ШСО-4', 'Шкаф ШСО-4 (2100x800x500)')).toBe('Шкаф ШСО-4 (2100x800x500)');
    });

    it('склеивает, когда модификация — это только размер', () => {
        expect(itemNameWithVariant('Шкаф ШСО-4', '2100x800x500')).toBe('Шкаф ШСО-4 2100x800x500');
    });

    it('схлопывает уже сохранённый дубль «X X»', () => {
        const name = 'Сушильный шкаф ШС-4/1 (1900х1200х620 мм)';
        expect(collapseDoubledName(`${name} ${name}`)).toBe(name);
        expect(collapseDoubledName('Доставка Доставка')).toBe('Доставка');
        // Разные слова не трогаем: «Шкаф сушильный» это не дубль.
        expect(collapseDoubledName('Шкаф сушильный')).toBe('Шкаф сушильный');
    });

    it('переживает пустую модификацию и лишние пробелы', () => {
        expect(itemNameWithVariant('  Шкаф   ШСО-4 ', '')).toBe('Шкаф ШСО-4');
        expect(itemNameWithVariant('', 'Доставка')).toBe('Доставка');
    });
});
