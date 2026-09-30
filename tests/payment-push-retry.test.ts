/**
 * Повторы проводки платежа: деньги не теряются, а человек не тонет в
 * одинаковых сообщениях. Инцидент 30.09.2026 — поломка магазина в RetailCRM.
 */
import { describe, it, expect } from 'vitest';
import { isCrmOutage, explainPushError } from '@/lib/payments/push-retry';

describe('сбой проводки платежа', () => {
    it('ошибку магазина узнаём как сбой на стороне RetailCRM', () => {
        expect(isCrmOutage("RetailCRM payment create failed: Invalid value for parameter 'site'")).toBe(true);
    });

    it('прочие ошибки не выдаём за сбой CRM', () => {
        expect(isCrmOutage('{"externalId":"This external id is already used"}')).toBe(false);
    });

    it('при сбое CRM объясняем, что делать ничего не нужно', () => {
        const text = explainPushError("Invalid value for parameter 'site'", 7);
        expect(text).toContain('делать ничего не нужно');
        expect(text).toContain('попыток уже 7');
    });

    it('при другой ошибке зовём на разбор', () => {
        const text = explainPushError('external id already used', 2);
        expect(text).toContain('нужен разбор');
    });
});
