/**
 * Разбор крон-выражений: на нём держится решение сторожа «исполнителю рано» или
 * «исполнитель сломался». Ошибка здесь — либо ложная тревога в выходной, либо
 * молчание при настоящей аварии.
 */
import { describe, it, expect } from 'vitest';
import { cronMatchesAt, cronRunsBetween, lastCronRunAt, parseCron, tryParseCron } from '@/lib/cron-schedule';

const utc = (iso: string) => new Date(`${iso}Z`);

describe('разбор крон-выражений', () => {
    it('понимает шаг, список, диапазон и звёздочку', () => {
        const everyFive = parseCron('*/5 * * * *');
        expect(everyFive.minutes.has(0)).toBe(true);
        expect(everyFive.minutes.has(5)).toBe(true);
        expect(everyFive.minutes.has(7)).toBe(false);

        const workingHours = parseCron('0 5,8,11,14 * * 1-5');
        expect([...workingHours.hours].sort((a, b) => a - b)).toEqual([5, 8, 11, 14]);
        expect([...workingHours.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it('отказывается молча принимать непонятное выражение', () => {
        expect(() => parseCron('* * *')).toThrow();
        expect(() => parseCron('0 99 * * *')).toThrow();
        expect(tryParseCron('не расписание')).toBeNull();
    });

    it('рабочее расписание не срабатывает в выходной', () => {
        const spec = parseCron('0 5,8,11,14 * * 1-5');
        // 16.10.2026 — пятница, 17.10.2026 — суббота.
        expect(cronMatchesAt(spec, utc('2026-10-16T05:00:00'))).toBe(true);
        expect(cronMatchesAt(spec, utc('2026-10-17T05:00:00'))).toBe(false);
        expect(cronMatchesAt(spec, utc('2026-10-17T09:00:00'))).toBe(false);
    });

    it('считает запуски в промежутке, не включая его начало', () => {
        const spec = parseCron('0 5,8,11,14 * * 1-5');
        // С вечера четверга до утра субботы отрабатывают только четыре пятничных захода.
        expect(cronRunsBetween(spec, utc('2026-10-15T21:20:00'), utc('2026-10-17T09:20:00'))).toBe(4);
        // Внутри одних выходных — ни одного.
        expect(cronRunsBetween(spec, utc('2026-10-17T00:00:00'), utc('2026-10-18T23:59:00'))).toBe(0);

        const everyMinute = parseCron('*/1 * * * *');
        expect(cronRunsBetween(everyMinute, utc('2026-10-17T09:00:00'), utc('2026-10-17T09:30:00'))).toBe(30);
    });

    it('находит последний запуск по расписанию', () => {
        const spec = parseCron('0 5,8,11,14 * * 1-5');
        // В субботу последним остаётся пятничный заход в 14:00.
        expect(lastCronRunAt(spec, utc('2026-10-17T09:20:00'))?.toISOString()).toBe('2026-10-16T14:00:00.000Z');
    });
});
