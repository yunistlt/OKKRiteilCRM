/**
 * Цена одной штуки со скидкой — в КП, счёте и карточке заказа.
 *
 * Менеджеры считали её на бумажке по каждой позиции: в документах стояли
 * базовая цена, скидка за штуку и сумма строки, а цены, по которой клиент
 * покупает одну штуку, не было нигде (Евгения Матвеева, Ирина Гордеева
 * 05.11.2026 — реестр доработок, записи 78 и 82).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { itemPriceWithDiscount } from '@/lib/own-crm/discount';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('цена за 1 шт. со скидкой', () => {
    it('считается как цена минус скидка за единицу', () => {
        // Заказ 900486: 98 101 ₽ за штуку, скидка 17 101 ₽ на штуку.
        expect(itemPriceWithDiscount({ price: 98101, quantity: 4, discountAmount: 17101 })).toBe(81000);
    });

    it('учитывает скидку процентом вместе с рублями', () => {
        expect(itemPriceWithDiscount({ price: 1000, quantity: 1, discountAmount: 100, discountPercent: 10 })).toBe(800);
    });

    it('стоит колонкой и в КП, и в счёте', () => {
        const pdf = read('lib/pdf-generator.tsx');
        // Два документа — два заголовка и две ячейки со своим стилем.
        expect(pdf.match(/Со скидкой\\nза 1 шт\., ₽/g)?.length).toBe(2);
        expect(pdf.match(/invStyles\.cNet/g)?.length).toBe(4);
    });

    it('стоит колонкой в карточке заказа, и таблица не разъезжается', () => {
        const modal = read('components/OrderDetailsModal.tsx');
        expect(modal).toContain('Со скидкой за 1 шт.');

        // Пустая таблица растягивает ячейку на все колонки: colSpan должен
        // совпадать с их числом, иначе строка «Позиций нет» уезжает.
        const head = modal.slice(modal.indexOf('<thead'), modal.indexOf('</thead>'));
        const columns = head.match(/<th\b/g)?.length ?? 0;
        const colSpan = Number(modal.match(/colSpan=\{(\d+)\}/)?.[1]);
        expect(colSpan).toBe(columns);
    });
});
