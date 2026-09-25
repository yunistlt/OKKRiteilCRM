import { describe, expect, it } from 'vitest';
import { assertSalesRopValue } from '@/lib/settings-registry/sales-rop';
import { nextMonthStart } from '@/lib/settings-registry/salary';
import { knobKey, knobModule } from '@/lib/settings-registry/types';

/**
 * Проверяем то, из-за чего в проде будет больно: границы нагрузки и дату, с
 * которой действует мотивация. Обращений к базе здесь нет — им нужен
 * service-role ключ, которого в тестах нет и быть не должно.
 */

describe('адрес ручки', () => {
    it('разбирается на подсистему и ключ', () => {
        expect(knobModule('sales_rop.load_factor')).toBe('sales_rop');
        expect(knobKey('sales_rop.load_factor')).toBe('load_factor');
    });

    it('у правила ОКК ключ остаётся составным', () => {
        expect(knobModule('okk.call_no_greeting.active')).toBe('okk');
        expect(knobKey('okk.call_no_greeting.active')).toBe('call_no_greeting.active');
    });

    it('выдуманная подсистема не проходит', () => {
        expect(knobModule('payroll.secret')).toBeNull();
    });
});

describe('нагрузка отдела', () => {
    it('в границах — принимается', () => {
        expect(() => assertSalesRopValue('load_factor', '1.05')).not.toThrow();
        expect(() => assertSalesRopValue('load_factor', '2')).not.toThrow();
    });

    // Десятка вместо единицы — самая дорогая опечатка в сервисе: отдел получает
    // список задач, который физически не сделать.
    it('завышенная — отвергается', () => {
        expect(() => assertSalesRopValue('load_factor', '10')).toThrow(/от 0.5 до 2.0/);
    });

    it('обнуляющая — отвергается', () => {
        expect(() => assertSalesRopValue('load_factor', '0')).toThrow();
        expect(() => assertSalesRopValue('load_factor', '-1')).toThrow();
    });

    it('не число — отвергается', () => {
        expect(() => assertSalesRopValue('load_factor', 'побольше')).toThrow();
    });
});

describe('остальные настройки бота', () => {
    it('норма задач — неотрицательное число', () => {
        expect(() => assertSalesRopValue('daily_target_tasks', '16')).not.toThrow();
        expect(() => assertSalesRopValue('daily_target_tasks', '-3')).toThrow();
    });

    it('переключатель — только да/нет', () => {
        expect(() => assertSalesRopValue('enabled', 'true')).not.toThrow();
        expect(() => assertSalesRopValue('enabled', 'ага')).toThrow();
    });
});

describe('дата вступления для мотивации', () => {
    // Задним числом менять ставки нельзя: период закрыт, деньги выплачены.
    it('первое число следующего месяца', () => {
        expect(nextMonthStart(new Date('2026-09-23T12:00:00Z'))).toBe('2026-10-01');
    });

    it('в декабре переходит через год', () => {
        expect(nextMonthStart(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
    });
});
