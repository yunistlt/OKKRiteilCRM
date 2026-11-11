/**
 * Отпуск и план дня.
 *
 * 11.11.2026 выяснилось, что Гордеева уходит в отпуск 12–26 ноября, а план ей
 * всё равно уйдёт — пятнадцать задач в день, две недели. Справочник отпусков
 * один (его ведёт «Катерина»), и утренний план обязан его читать.
 */
import { describe, it, expect } from 'vitest';
import { absenceOn, absentToday, daysUntil, nextAbsence, type Absence } from '@/lib/sales-rop/absences';

const irina: Absence = { managerId: 249, from: '2026-11-12', to: '2026-11-26', note: null };
const elena: Absence = { managerId: 10, from: '2026-07-01', to: '2026-07-14', note: 'отпуск' };
const list = [irina, elena];

describe('отпуск', () => {
    it('в первый и последний день отпуск ещё идёт', () => {
        expect(absenceOn(list, 249, '2026-11-12')).toBe(irina);
        expect(absenceOn(list, 249, '2026-11-26')).toBe(irina);
    });

    it('накануне и после — человек работает', () => {
        expect(absenceOn(list, 249, '2026-11-11')).toBeNull();
        expect(absenceOn(list, 249, '2026-11-27')).toBeNull();
    });

    it('чужой отпуск не считается своим', () => {
        expect(absenceOn(list, 98, '2026-11-12')).toBeNull();
        expect(absenceOn(list, null, '2026-11-12')).toBeNull();
    });

    it('видно, что отпуск завтра: до него один день', () => {
        const next = nextAbsence(list, 249, '2026-11-11');
        expect(next).toBe(irina);
        expect(daysUntil(next!.from, '2026-11-11')).toBe(1);
    });

    it('прошлый отпуск будущим не считается', () => {
        expect(nextAbsence(list, 10, '2026-11-11')).toBeNull();
    });

    it('кто отсутствует сегодня — по всему отделу', () => {
        expect(absentToday(list, '2026-11-13').map((a) => a.managerId)).toEqual([249]);
        expect(absentToday(list, '2026-11-11')).toEqual([]);
    });
});
