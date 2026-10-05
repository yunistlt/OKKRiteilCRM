import { describe, it, expect } from 'vitest';
import { orderFromSubject, taggedOrderNumber } from '@/lib/email/order-tag';

/** Письма по заказу носят тег `[#магазин/номер]` — по нему и цепляются. */
describe('номер заказа из темы письма', () => {
    it('тег в теме — надёжная привязка', () => {
        expect(taggedOrderNumber('[#2/49583] 1455150, Отложено')).toBe('49583');
        expect(taggedOrderNumber('Re: [#2/53590] Коммерческое предложение ШМИ-251')).toBe('53590');
        expect(taggedOrderNumber('RE: [#3/52726] уточнение по заказу 52726')).toBe('52726');
    });

    it('без тега номер только угадывается и привязкой не считается', () => {
        const guess = orderFromSubject('уточнение по заказу 52726');
        expect(guess.tagged).toBeNull();
        expect(guess.guessed).toBe('52726');
        expect(taggedOrderNumber('уточнение по заказу 52726')).toBeNull();
    });

    it('случайные числа в теме за номер заказа не принимаем', () => {
        for (const subject of ['Счёт на 195213 рублей', 'Индекс 195213', 'ШМИ-151-А(Z) 48419']) {
            expect(taggedOrderNumber(subject)).toBeNull();
            expect(orderFromSubject(subject).guessed).toBeNull();
        }
    });

    it('пустая тема ничего не ломает', () => {
        expect(taggedOrderNumber(null)).toBeNull();
        expect(orderFromSubject(undefined)).toEqual({ tagged: null, guessed: null });
    });
});
