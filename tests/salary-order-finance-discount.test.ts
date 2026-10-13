import { describe, expect, it } from 'vitest';
import { computeOrderFinance } from '@/lib/salary/metrics';

const RULES = [{ vat_pct: 0, divisor: 1 }, { vat_pct: 5, divisor: 1.05 }, { vat_pct: 20, divisor: 1.2 }];

/**
 * Жалоба Евгении Матвеевой 13.10.2026: выручка без НДС выходила больше суммы
 * заказа с НДС. Скидку из позиций не вычитали.
 */
describe('выручка заказа: скидка вычтена, НДС снят', () => {
    it('без prices: discountTotal — скидка на единицу, её снимаем', () => {
        // Заказ 53508: 7×(72 870−14 570) + 1×(59 270.4−9 470) = 457 900.4 ₽
        const items = [
            { quantity: 7, initialPrice: 72870, discountTotal: 14570 },
            { quantity: 1, initialPrice: 59270.4, discountTotal: 9470 },
        ];
        const fin = computeOrderFinance(items, 5, RULES, 457900.4);
        expect(Math.round(fin.revenueNoVat)).toBe(Math.round(457900.4 / 1.05));
        expect(fin.revenueNoVat).toBeLessThan(457900.4);
        expect(Math.round(fin.discountAmount)).toBe(Math.round(569360 - 457900.4));
    });

    it('с prices: цена уже со скидкой, второй раз не вычитаем', () => {
        const items = [{ quantity: 2, initialPrice: 1000, discountTotal: 100, prices: [{ price: 900 }] }];
        const fin = computeOrderFinance(items, 5, RULES, 1800);
        expect(Math.round(fin.revenueNoVat)).toBe(Math.round(1800 / 1.05));
    });

    it('скидка на весь заказ: приводим к сумме заказа', () => {
        const items = [{ quantity: 1, initialPrice: 100000, discountTotal: 0 }];
        const fin = computeOrderFinance(items, 5, RULES, 75000); // −25% на заказ
        expect(Math.round(fin.revenueNoVat)).toBe(Math.round(75000 / 1.05));
        expect(Math.round(fin.discountPct)).toBe(25);
    });

    it('суммы заказа нет — считаем по позициям', () => {
        const items = [{ quantity: 1, initialPrice: 1050, discountTotal: 0 }];
        expect(computeOrderFinance(items, 5, RULES, null).revenueNoVat).toBe(1000);
    });
});
