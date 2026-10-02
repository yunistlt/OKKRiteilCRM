import { describe, it, expect } from 'vitest';
import {
    itemDiscountPerUnit,
    itemPriceWithDiscount,
    itemTotalWithDiscount,
    orderTotals,
} from '@/lib/own-crm/discount';

/**
 * Скидки считаем по правилам RetailCRM — цифры должны совпадать с её карточкой.
 * Контрольные примеры взяты с живых заказов (49583 и заказ из скриншота
 * владельца 02.10.2026).
 */
describe('скидки заказа', () => {
    it('скидка рублями на единицу: заказ 49583', () => {
        const item = { price: 62234, quantity: 24, discountAmount: 13034 };

        expect(itemDiscountPerUnit(item)).toBe(13034);
        expect(itemPriceWithDiscount(item)).toBe(49200);
        expect(itemTotalWithDiscount(item)).toBe(1180800);

        const totals = orderTotals([item, { price: 180600, quantity: 1 }], {});
        expect(totals.itemsGross).toBe(1674216);
        expect(totals.itemsDiscount).toBe(312816);
        expect(totals.total).toBe(1361400);
    });

    it('скидка процентом переводится в рубли от цены единицы', () => {
        const item = { price: 7560, quantity: 2, discountPercent: 7.4074 };
        expect(itemPriceWithDiscount(item)).toBe(7000);
        expect(itemTotalWithDiscount(item)).toBe(14000);
    });

    it('рубли и процент у позиции складываются', () => {
        const item = { price: 1000, quantity: 1, discountAmount: 100, discountPercent: 10 };
        expect(itemDiscountPerUnit(item)).toBe(200);
        expect(itemPriceWithDiscount(item)).toBe(800);
    });

    it('скидка не делает цену отрицательной', () => {
        expect(itemPriceWithDiscount({ price: 500, quantity: 3, discountAmount: 900 })).toBe(0);
        expect(itemDiscountPerUnit({ price: 500, quantity: 3, discountAmount: 900 })).toBe(500);
    });

    it('разовая скидка на заказ считается после скидок позиций', () => {
        const items = [
            { price: 7560, quantity: 2, discountAmount: 560 },
            { price: 1080, quantity: 2, discountAmount: 45 },
        ];

        const plain = orderTotals(items, {});
        expect(plain.itemsGross).toBe(17280);
        expect(plain.itemsDiscount).toBe(1210);
        expect(plain.total).toBe(16070);

        // Процент разовой скидки — от стоимости товаров уже со скидками позиций.
        const withPercent = orderTotals(items, { discountPercent: 10 });
        expect(withPercent.orderDiscount).toBe(1607);
        expect(withPercent.discountTotal).toBe(2817);
        expect(withPercent.total).toBe(14463);

        const withAmount = orderTotals(items, { discountAmount: 70 });
        expect(withAmount.orderDiscount).toBe(70);
        expect(withAmount.total).toBe(16000);
    });

    it('на доставку скидка не распространяется', () => {
        const totals = orderTotals([{ price: 1000, quantity: 1 }], { discountPercent: 50, deliveryCost: 500 });
        expect(totals.orderDiscount).toBe(500);
        expect(totals.deliveryCost).toBe(500);
        expect(totals.total).toBe(1000);
    });

    it('разовая скидка не больше стоимости товаров', () => {
        const totals = orderTotals([{ price: 1000, quantity: 1 }], { discountAmount: 5000 });
        expect(totals.orderDiscount).toBe(1000);
        expect(totals.total).toBe(0);
    });
});
