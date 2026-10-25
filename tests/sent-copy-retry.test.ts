/**
 * Терпение повторов дозаписи копии письма.
 *
 * Сбой 12.10.2026 длился семь часов, а задача сдавалась за пятнадцать минут.
 * Тест закрепляет главное: с нынешними настройками очередь переживает рабочий
 * день отказов ящика.
 */
import { describe, expect, it } from 'vitest';
import { sentCopyPatienceSeconds, sentCopyRetryDelay } from '@/lib/email/sent-copy-retry';

describe('повторы дозаписи копии в «Отправленные»', () => {
    it('первые попытки частые: минутные перебои ящика переживаем без задержки для человека', () => {
        expect(sentCopyRetryDelay(1)).toBe(120);
        expect(sentCopyRetryDelay(2)).toBe(600);
    });

    it('дальше паузы растут: быстрые повторы ограничение ящика только продлевают', () => {
        expect(sentCopyRetryDelay(3)).toBeGreaterThan(sentCopyRetryDelay(2));
        expect(sentCopyRetryDelay(5)).toBeGreaterThan(sentCopyRetryDelay(4));
    });

    it('кривое число попыток не ломает лестницу', () => {
        expect(sentCopyRetryDelay(0)).toBe(120);
        expect(sentCopyRetryDelay(-7)).toBe(120);
        expect(sentCopyRetryDelay(Number.NaN)).toBe(120);
        expect(sentCopyRetryDelay(999)).toBe(21600);
    });

    it('десять попыток терпят больше суток — семичасовой сбой переживают', () => {
        const patience = sentCopyPatienceSeconds(10);
        expect(patience).toBeGreaterThan(24 * 3600);
        // Тот самый сбой: с 11:00 до 18:00.
        expect(patience).toBeGreaterThan(7 * 3600);
    });

    it('прежние пять попыток по две минуты тот сбой не переживали', () => {
        expect(4 * 120).toBeLessThan(7 * 3600);
    });
});
