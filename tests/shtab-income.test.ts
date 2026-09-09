import { describe, expect, it } from 'vitest';
import { NON_INCOME_STATUSES, monthlyIncome, monthsAgo } from '@/lib/shtab/income';

describe('monthlyIncome', () => {
    it('складывает копейки по месяцам и отдаёт рубли', () => {
        expect(
            monthlyIncome([
                { payment_date: '2026-01-05', amount_kopecks: 150_000_00 },
                { payment_date: '2026-01-28', amount_kopecks: 50_000_00 },
                { payment_date: '2026-02-01', amount_kopecks: 300_000_00 },
            ]),
        ).toEqual([
            { month: '2026-01', rubles: 200_000 },
            { month: '2026-02', rubles: 300_000 },
        ]);
    });

    it('копейки не теряются на длинных суммах', () => {
        // Триста платежей по 33 копейки: сложение рублей в плавающей точке
        // здесь бы уже поехало.
        const rows = Array.from({ length: 300 }, () => ({ payment_date: '2026-03-10', amount_kopecks: 33 }));
        expect(monthlyIncome(rows)).toEqual([{ month: '2026-03', rubles: 99 }]);
    });

    it('bigint из драйвера приходит строкой и тоже считается', () => {
        expect(monthlyIncome([{ payment_date: '2026-04-02', amount_kopecks: '12345678' }])).toEqual([
            { month: '2026-04', rubles: 123456.78 },
        ]);
    });

    it('строки без даты и суммы пропускает, а не роняет ряд', () => {
        expect(
            monthlyIncome([
                { payment_date: null, amount_kopecks: 100 },
                { payment_date: '2026-05-01', amount_kopecks: null },
                { payment_date: '2026-05-02', amount_kopecks: 'не число' },
                { payment_date: '2026-05-03', amount_kopecks: 10_000 },
            ]),
        ).toEqual([{ month: '2026-05', rubles: 100 }]);
    });

    it('пустых месяцев не выдумывает', () => {
        // XmR должен видеть реальные наблюдения; нули, которых не было,
        // занизили бы центральную линию и раздули границы.
        const points = monthlyIncome([
            { payment_date: '2026-01-10', amount_kopecks: 100_00 },
            { payment_date: '2026-04-10', amount_kopecks: 100_00 },
        ]);
        expect(points.map((p) => p.month)).toEqual(['2026-01', '2026-04']);
    });

    it('пустой вход — пустой ряд', () => {
        expect(monthlyIncome([])).toEqual([]);
    });
});

describe('monthsAgo', () => {
    it('отсчитывает от начала месяца и переходит через год', () => {
        expect(monthsAgo(2, new Date('2026-03-17T12:00:00Z'))).toBe('2026-01-01');
        expect(monthsAgo(14, new Date('2026-03-17T12:00:00Z'))).toBe('2025-01-01');
    });
});

describe('NON_INCOME_STATUSES', () => {
    it('исключает только ignored: остальные статусы — про матчинг, деньги пришли', () => {
        expect([...NON_INCOME_STATUSES]).toEqual(['ignored']);
    });
});
