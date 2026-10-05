import { describe, expect, it } from 'vitest';
import { isRelative, relativeLabel, relativeToken, resolveDate } from '@/lib/relative-date';

const today = new Date(2026, 9, 1); // 1 октября 2026

describe('относительные даты в фильтрах', () => {
    it('неделя назад считается от сегодня', () => {
        expect(resolveDate('rel:-1w', today)).toBe('2026-09-24');
    });

    it('месяц вперёд считается от сегодня', () => {
        expect(resolveDate('rel:+1m', today)).toBe('2026-11-01');
    });

    it('нулевое смещение — это сегодня', () => {
        expect(resolveDate('rel:+0d', today)).toBe('2026-10-01');
    });

    it('обычную дату не трогает', () => {
        expect(resolveDate('2026-05-17', today)).toBe('2026-05-17');
    });

    it('пустое значение остаётся пустым', () => {
        expect(resolveDate('', today)).toBe('');
        expect(resolveDate(null, today)).toBe('');
    });

    it('смещение живое: та же запись в другой день даёт другую дату', () => {
        const tomorrow = new Date(2026, 9, 2);
        expect(resolveDate('rel:+1d', today)).toBe('2026-10-02');
        expect(resolveDate('rel:+1d', tomorrow)).toBe('2026-10-03');
    });

    it('узнаёт смещение и обычную дату', () => {
        expect(isRelative('rel:-3d')).toBe(true);
        expect(isRelative('2026-10-01')).toBe(false);
    });

    it('называет смещение по-русски', () => {
        expect(relativeLabel('rel:-1d')).toBe('1 день назад');
        expect(relativeLabel('rel:-3d')).toBe('3 дня назад');
        expect(relativeLabel('rel:-7d')).toBe('7 дней назад');
        expect(relativeLabel('rel:+1m')).toBe('через 1 месяц');
        expect(relativeLabel('rel:+0d')).toBe('сегодня');
    });

    it('собирает значение фильтра', () => {
        expect(relativeToken(2, 'w', -1)).toBe('rel:-2w');
        expect(relativeToken(1, 'y', 1)).toBe('rel:+1y');
    });
});
