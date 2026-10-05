import { describe, expect, it } from 'vitest';
import { clientTime, moscowShift } from '@/lib/own-crm/phone-timezone';

describe('местное время клиента по номеру', () => {
    it('знает код Екатеринбурга', () => {
        expect(moscowShift('+7(343) 286-81-62')).toBe(2);
    });

    it('знает Москву и Калининград', () => {
        expect(moscowShift('84952223344')).toBe(0);
        expect(moscowShift('+7 401 123-45-67')).toBe(-1);
    });

    it('по мобильному время не выдумывает', () => {
        expect(moscowShift('+7-932-11-42-746')).toBeNull();
        expect(clientTime('+7-932-11-42-746')).toBeNull();
    });

    it('считает время от московского', () => {
        // 12:00 по Москве — во Владивостоке (423) уже 19:00.
        const at = new Date('2026-10-05T09:00:00Z');
        expect(clientTime('+7 423 222-33-44', at)?.time).toBe('19:00');
        expect(clientTime('+7 423 222-33-44', at)?.shift).toBe('+7 ч к Москве');
    });
});
