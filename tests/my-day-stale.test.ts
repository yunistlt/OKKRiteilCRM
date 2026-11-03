/**
 * «Нет движения N дн.» в «Моём дне» — доработка №76.
 *
 * Жалоба Ирины Гордеевой 03.11.2026: «Указано, что нет движения 6 дней, дозвон
 * был вчера т.е 02.11 и стоит созвон на пятницу 06.11».
 */
import { describe, it, expect } from 'vitest';
import { staleSilence } from '@/lib/analytics/my-day';

const TODAY = new Date('2026-11-03T12:00:00');
const STALE_DAYS = 5;

const silence = (over: { lastTouchAt?: string | null; contactDate?: string | null } = {}) =>
    staleSilence({
        lastTouchAt: '2026-10-20T10:00:00',
        contactDate: null,
        today: TODAY,
        staleDays: STALE_DAYS,
        ...over,
    });

describe('зависший заказ', () => {
    it('заказ не трогали две недели — зависший', () => {
        expect(silence()).toBe(14);
    });

    it('говорили вчера — не зависший, хотя в статусе стоит давно', () => {
        expect(silence({ lastTouchAt: '2026-11-02T11:00:00' })).toBeNull();
    });

    it('созвон назначен на пятницу — в план дня не берём', () => {
        expect(silence({ contactDate: '2026-11-06' })).toBeNull();
    });

    it('созвон назначен на сегодня — заказ ждёт сегодняшнего разговора, не зависший', () => {
        expect(silence({ contactDate: '2026-11-03' })).toBeNull();
    });

    it('обещание просрочено — заказ снова в плане', () => {
        expect(silence({ contactDate: '2026-10-28' })).toBe(14);
    });

    it('касаний нет вовсе — числа тоже нет, выдумывать не будем', () => {
        expect(silence({ lastTouchAt: null })).toBeNull();
    });

    it('порог ровно на границе считается зависшим', () => {
        expect(silence({ lastTouchAt: '2026-10-29T12:00:00' })).toBe(5);
        expect(silence({ lastTouchAt: '2026-10-30T12:00:00' })).toBeNull();
    });
});
