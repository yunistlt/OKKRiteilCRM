/**
 * Создание заказа менеджером: считаем суммы и не пускаем в CRM заказ, который
 * там всё равно не сохранится или окажется пустым.
 */
import { describe, it, expect } from 'vitest';
import { validateNewOrder, itemTotal, orderTotal } from '@/lib/own-crm/create-order';

const base = {
    contactName: 'Иван',
    phone: '+79001234567',
    items: [{ name: 'Шкаф сушильный', quantity: 2, price: 39190 }],
};

describe('суммы заказа', () => {
    it('позиция считается как цена на количество', () => {
        expect(itemTotal({ name: 'x', quantity: 3, price: 1500 })).toBe(4500);
    });

    it('сумма заказа складывается из позиций', () => {
        expect(orderTotal([
            { name: 'a', quantity: 2, price: 100 },
            { name: 'b', quantity: 1, price: 350 },
        ])).toBe(550);
    });

    it('отрицательной суммы не бывает', () => {
        expect(itemTotal({ name: 'x', quantity: 0, price: 1000 })).toBe(0);
    });
});

describe('проверка заказа до отправки', () => {
    it('нормальный заказ проходит', () => {
        expect(validateNewOrder(base as any)).toEqual([]);
    });

    it('без позиций пускаем: заявка приходит до просчёта', () => {
        expect(validateNewOrder({ ...base, items: [] } as any)).toEqual([]);
    });

    it('без клиента не пускаем', () => {
        const problems = validateNewOrder({ items: base.items } as any);
        expect(problems.join(' ')).toContain('Не указан клиент');
    });

    it('говорит, в какой именно позиции ошибка', () => {
        const problems = validateNewOrder({
            ...base,
            items: [{ name: 'Шкаф', quantity: 1, price: 100 }, { name: '', quantity: 0, price: -5 }],
        } as any);
        expect(problems.join(' ')).toContain('Позиция 2');
        expect(problems.join(' ')).not.toContain('Позиция 1');
    });
});
