/**
 * Тесты дефолтов карточки заказа для лидов ботов: lib/retailcrm/lead-defaults.ts
 *
 * Проверяем дату следующего контакта: сегодня, а после 17:00 по Тольятти (UTC+4) — завтра.
 * Сервер живёт в UTC, поэтому граница в UTC — 13:00.
 */

import { describe, it, expect } from 'vitest';
import { nextContactDate, DEFAULT_PRODUCTION_DAYS } from '@/lib/retailcrm/lead-defaults';

describe('nextContactDate', () => {
    it('утренняя заявка — контакт сегодня', () => {
        // 09:00 UTC = 13:00 в Тольятти
        expect(nextContactDate(new Date('2026-07-21T09:00:00Z'))).toBe('2026-07-21');
    });

    it('ровно 17:00 по Тольятти — уже завтра', () => {
        expect(nextContactDate(new Date('2026-07-21T13:00:00Z'))).toBe('2026-07-22');
    });

    it('за минуту до 17:00 по Тольятти — ещё сегодня', () => {
        expect(nextContactDate(new Date('2026-07-21T12:59:00Z'))).toBe('2026-07-21');
    });

    it('ночная заявка по UTC уже относится к следующему дню в Тольятти', () => {
        // 21:00 UTC = 01:00 следующего дня в Тольятти, до 17:00 — контакт в тот же местный день
        expect(nextContactDate(new Date('2026-07-21T21:00:00Z'))).toBe('2026-07-22');
    });

    it('переход через конец месяца', () => {
        expect(nextContactDate(new Date('2026-07-31T15:00:00Z'))).toBe('2026-08-01');
    });
});

describe('дефолты', () => {
    it('срок изготовления по умолчанию — 20 дней', () => {
        expect(DEFAULT_PRODUCTION_DAYS).toBe(20);
    });
});
