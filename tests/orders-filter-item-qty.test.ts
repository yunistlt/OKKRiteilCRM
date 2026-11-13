/**
 * Фильтр «Кол-во шт» рядом с наименованием товара.
 *
 * Просьба Лены Парфёновой 05.11.2026 (доработка 80): по одному названию
 * находятся и заказы на штуку, и на полсотни, а нужен конкретный.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseOrdersFilter, EMPTY_FILTER } from '@/lib/orders-filter';
import { FILTER_FIELDS } from '@/lib/orders-view';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('фильтр по количеству штук', () => {
    it('читается из адреса страницы', () => {
        const filter = parseOrdersFilter(new URLSearchParams('itemName=ШС-8&itemQty=10'));
        expect(filter.itemName).toBe('ШС-8');
        expect(filter.itemQty).toBe('10');
    });

    it('пустой по умолчанию — количество не сужает выборку', () => {
        expect(EMPTY_FILTER.itemQty).toBe('');
        expect(parseOrdersFilter(new URLSearchParams('')).itemQty).toBe('');
    });

    it('стоит в списке полей рядом с товарами', () => {
        const field = FILTER_FIELDS.find((f) => f.key === 'itemQty');
        expect(field).toBeTruthy();
        expect(field?.group).toBe('Товары');
        // Человеческое название, без кодов.
        expect(field?.label).toBe('Кол-во шт');
    });

    it('маршрут списка отбирает заказы базой и сужает ими общий список', () => {
        const route = read('app/api/orders/list/route.ts');
        expect(route).toContain('orders_item_qty_ids');
        // Пересечение с поиском по словам: строки и счётчики считаются по
        // одним и тем же заказам.
        expect(route).toContain('filter.searchIds.filter((id) => allowed.has(id))');
    });

    it('о потолке отбора говорит интерфейс, а не тишина', () => {
        expect(read('app/api/orders/list/route.ts')).toContain('itemQtyCapped');
        expect(read('app/orders/OrdersClient.tsx')).toContain('показаны первые');
    });

    it('в поле количества остаются только цифры', () => {
        const panel = read('components/orders/OrdersFilterPanel.tsx');
        expect(panel).toContain("v.replace(/[^0-9]/g, '')");
    });
});
