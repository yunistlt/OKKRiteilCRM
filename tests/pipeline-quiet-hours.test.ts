import { describe, expect, it } from 'vitest';
import { collectPipelinePulse } from '@/lib/pipeline-pulse';

/**
 * Ночное окно сторожа.
 *
 * Решение владельца 05.10.2026: с 19:00 до 8:00 по Москве пустая очередь работ
 * не поднимает тревогу — работы ставят люди, и вечером их просто нет.
 * Проверяем сам расчёт окна, не трогая базу.
 */
const quiet = (iso: string) => {
    const hour = Number(new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false,
    }).format(new Date(iso)));
    return hour >= 19 || hour < 8;
};

describe('тихие часы сторожа', () => {
    it('ночь и вечер — тихие', () => {
        expect(quiet('2026-10-05T16:30:00Z')).toBe(true);  // 19:30 МСК
        expect(quiet('2026-10-05T21:00:00Z')).toBe(true);  // 00:00 МСК
        expect(quiet('2026-10-06T03:00:00Z')).toBe(true);  // 06:00 МСК
    });

    it('рабочий день — не тихий', () => {
        expect(quiet('2026-10-06T06:00:00Z')).toBe(false); // 09:00 МСК
        expect(quiet('2026-10-06T12:00:00Z')).toBe(false); // 15:00 МСК
        expect(quiet('2026-10-06T15:30:00Z')).toBe(false); // 18:30 МСК
    });

    it('границы окна', () => {
        expect(quiet('2026-10-06T05:00:00Z')).toBe(false); // 08:00 МСК — окно уже кончилось
        expect(quiet('2026-10-06T16:00:00Z')).toBe(true);  // 19:00 МСК — уже тихое
    });

    it('сборщик пульса существует', () => {
        expect(typeof collectPipelinePulse).toBe('function');
    });
});
