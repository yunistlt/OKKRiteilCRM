/**
 * Поиск заказа по номеру телефона — доработки №75 и №77.
 *
 * По заказу 54013 (СТМ-Сервис) было шесть разговоров за неделю и ни одной
 * привязки: телефон записан как «+7(909)355-31-61», а искали цифры подстрокой.
 */
import { describe, it, expect } from 'vitest';
import { phoneTail7, phoneTailFilter } from '@/lib/orders-by-phone';

describe('ключ поиска по телефону', () => {
    it('номер со скобками и дефисами даёт тот же хвост, что и слитный', () => {
        expect(phoneTail7('+7(909)355-31-61')).toBe('3553161');
        expect(phoneTail7('+79093553161')).toBe('3553161');
        expect(phoneTail7('8 909 355 31 61')).toBe('3553161');
    });

    it('приписка в номере хвост не ломает', () => {
        expect(phoneTail7('8(910)222-11-77 (мессенджеры доступны)')).toBe('2221177');
        expect(phoneTail7('+79951140290 Мария')).toBe('1140290');
    });

    it('короткий номер ключом не бывает', () => {
        expect(phoneTail7('120')).toBeNull();
        expect(phoneTail7('')).toBeNull();
        expect(phoneTail7(null)).toBeNull();
    });

    it('условие ищет и основной телефон, и дополнительный', () => {
        expect(phoneTailFilter(['3553161'])).toBe('phone_tail7.eq.3553161,additional_phone_tail7.eq.3553161');
    });

    it('несколько номеров — одно условие', () => {
        expect(phoneTailFilter(['3553161', '5349990'])).toBe(
            'phone_tail7.eq.3553161,additional_phone_tail7.eq.3553161,'
            + 'phone_tail7.eq.5349990,additional_phone_tail7.eq.5349990',
        );
    });
});
