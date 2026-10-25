/**
 * Код статуса — свой, а не RetailCRM.
 *
 * Статус, заведённый в нашей CRM, не имеет external_code. Раньше такие статусы
 * молча пропадали из карточки заказа («Дубль заявки» был на доске переходов, но
 * перевести в него заказ было нельзя — 21.10.2026). Этот тест держит правило:
 * показываем свой код, а узнаём статус по обоим.
 */
import { describe, it, expect } from 'vitest';
import { byStatusCode, findStatus, statusCodeOf, statusKeysOf, statusMatches } from '@/lib/own-crm/status-code';

const own = { code: 'dubl-zayavki', external_code: null, name: 'Дубль заявки' };
const legacy = { code: 'novyi-1', external_code: 'novyi-1', name: 'Новый' };
const renamed = { code: 'dubl-zayavki-2', external_code: 'dubliu-zaiavki', name: 'Дубль (старый код)' };

describe('коды статусов', () => {
    it('свой статус без external_code имеет код', () => {
        expect(statusCodeOf(own)).toBe('dubl-zayavki');
    });

    it('показываем свой код, даже когда есть старый из RetailCRM', () => {
        expect(statusCodeOf(renamed)).toBe('dubl-zayavki-2');
    });

    it('узнаём статус по обоим кодам — старые заказы не теряются', () => {
        expect(statusMatches(renamed, 'dubliu-zaiavki')).toBe(true);
        expect(statusMatches(renamed, 'dubl-zayavki-2')).toBe(true);
        expect(statusMatches(own, 'dubl-zayavki')).toBe(true);
        expect(statusMatches(own, 'novyi-1')).toBe(false);
        expect(statusMatches(own, '')).toBe(false);
    });

    it('пустой код статуса не ищем', () => {
        expect(findStatus([own, legacy], null)).toBeUndefined();
        expect(statusKeysOf({ code: null, external_code: null })).toEqual([]);
    });

    it('карта по коду отвечает на оба кода', () => {
        const map = byStatusCode([own, renamed], (s) => s.name);
        expect(map.get('dubl-zayavki')).toBe('Дубль заявки');
        expect(map.get('dubliu-zaiavki')).toBe('Дубль (старый код)');
        expect(map.get('dubl-zayavki-2')).toBe('Дубль (старый код)');
    });

    it('статус без собственного кода опознаётся по старому', () => {
        const legacyOnly = { code: null, external_code: 'cancel-other' };
        expect(statusCodeOf(legacyOnly)).toBe('cancel-other');
        expect(statusMatches(legacyOnly, 'cancel-other')).toBe(true);
    });
});
