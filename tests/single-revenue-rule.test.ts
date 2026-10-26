import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * Правило расчёта денег — одно, в движке зарплаты (lib/salary).
 *
 * Сторож против возврата второй формулы: 13.10.2026 TS научили вычитать скидку
 * на заказ целиком, а SQL-зеркало salary_revenue_no_vat осталось старым — и
 * «Мой день» показывал Матвеевой 3 761 163 ₽ против 3 456 289 ₽ в ведомости по
 * одному и тому же набору заказов.
 */
describe('одно правило расчёта выручки', () => {
    const grep = (pattern: string) => {
        try {
            return execSync(`grep -rn "${pattern}" lib app --include=*.ts --include=*.tsx`, {
                encoding: 'utf8',
            }).trim();
        } catch {
            return ''; // grep без совпадений выходит с кодом 1 — это успех
        }
    };

    it('в коде не осталось вызовов SQL-формулы выручки', () => {
        // Упоминание в комментарии истории допустимо — важно, что её не зовут.
        const calls = grep('salary_revenue_no_vat')
            .split('\n')
            .filter((line) => line.includes('rpc(') || line.includes('select') || line.includes('from('));
        expect(calls).toEqual([]);
    });

    it('факт месяца по менеджерам не считается в базе', () => {
        expect(grep('sales_rop_month_by_manager')).toBe('');
    });

    it('выручку без НДС считает только движок зарплаты', () => {
        const callers = grep('computeOrderFinance(')
            .split('\n')
            .filter(Boolean)
            .map((line) => line.split(':')[0]);
        const unique = Array.from(new Set(callers)).sort();
        expect(unique).toEqual(['lib/salary/metrics.ts', 'lib/salary/month-fact.ts']);
    });
});
