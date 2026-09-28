import { describe, expect, it } from 'vitest';
import { enforcementCaseUpdateSchema } from '@/lib/legal-enforcement/types';

// Правка карточки ИП руками. Самое опасное здесь — деньги: человек вводит рубли, а в
// базе копейки, и ошибка в сто раз уедет прямо в ФД-отчёт.
describe('правка карточки исполнительного производства', () => {
    it('переводит введённые рубли в копейки', () => {
        const parsed = enforcementCaseUpdateSchema.parse({ debt_amount_kopecks: '1234.56' });
        expect(parsed.debt_amount_kopecks).toBe(123456);
    });

    it('понимает запятую и пробелы в сумме — так её и пишут руками', () => {
        const parsed = enforcementCaseUpdateSchema.parse({ debt_amount_kopecks: '1 234,50' });
        expect(parsed.debt_amount_kopecks).toBe(123450);
    });

    it('целое число рублей не теряет копейки', () => {
        const parsed = enforcementCaseUpdateSchema.parse({ charge_amount_kopecks: '900' });
        expect(parsed.charge_amount_kopecks).toBe(90000);
    });

    it('пустое поле означает очистку, а не ноль', () => {
        const parsed = enforcementCaseUpdateSchema.parse({ debt_amount_kopecks: '', bailiff_name: '  ' });
        expect(parsed.debt_amount_kopecks).toBeNull();
        expect(parsed.bailiff_name).toBeNull();
    });

    it('отрицательную сумму не принимает', () => {
        expect(() => enforcementCaseUpdateSchema.parse({ debt_amount_kopecks: '-5' })).toThrow();
    });

    it('дату принимает только в виде ГГГГ-ММ-ДД', () => {
        expect(enforcementCaseUpdateSchema.parse({ started_on: '2026-09-28' }).started_on).toBe('2026-09-28');
        expect(() => enforcementCaseUpdateSchema.parse({ started_on: '28.09.2026' })).toThrow();
    });

    it('ИНН проверяет по длине', () => {
        expect(enforcementCaseUpdateSchema.parse({ debtor_inn: '7707083893' }).debtor_inn).toBe('7707083893');
        expect(() => enforcementCaseUpdateSchema.parse({ debtor_inn: '123' })).toThrow();
    });

    it('не трогает поля, которых не прислали', () => {
        const parsed = enforcementCaseUpdateSchema.parse({ bailiff_name: 'Иванов И.И.' });
        expect(parsed.bailiff_name).toBe('Иванов И.И.');
        expect(parsed.debt_amount_kopecks).toBeUndefined();
    });

    it('статус и пометку образца через правку полей поменять нельзя', () => {
        const parsed = enforcementCaseUpdateSchema.parse({
            bailiff_name: 'Петров',
            status: 'in_fd_report',
            is_sample: false,
        } as any);
        expect('status' in parsed).toBe(false);
        expect('is_sample' in parsed).toBe(false);
    });
});
