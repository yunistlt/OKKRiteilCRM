/**
 * Повторы разноса оплаты: деньги не теряются, а человек не тонет в
 * одинаковых сообщениях. Инцидент 30.09.2026 — поток «Оплата не проведена».
 */
import { describe, it, expect } from 'vitest';
import { isWaitingForOrder, explainPushError } from '@/lib/payments/push-retry';

describe('сбой разноса оплаты', () => {
    it('отсутствие заказа в базе узнаём как ожидание, а не поломку', () => {
        expect(isWaitingForOrder('Оплата не разнесена: заказ 54755 не найден в базе ОКК')).toBe(true);
    });

    it('прочие ошибки не выдаём за ожидание заказа', () => {
        expect(isWaitingForOrder('Не удалось записать оплату: duplicate key')).toBe(false);
    });

    it('пока заказа нет, объясняем, что делать ничего не нужно', () => {
        const text = explainPushError('заказ 54755 не найден в базе ОКК', 7);
        expect(text).toContain('делать ничего не нужно');
        expect(text).toContain('попыток уже 7');
    });

    it('при другой ошибке зовём на разбор', () => {
        const text = explainPushError('external id already used', 2);
        expect(text).toContain('нужен разбор');
    });
});
