/**
 * Правило «Дубль заявки»: у статуса два кода — старый `dubliu-zaiavki` (RetailCRM)
 * и наш `dubl-zayavki` с переезда на свою доску. Пока правило держало один код,
 * заказы в новом статусе падали в конверсию (доработка №66, Евгения Матвеева
 * 30.10.2026 — заказы 900312 и 900387). Кейсы — их настоящие комментарии.
 */
import { describe, it, expect } from 'vitest';
import { evaluateRequestDuplicate, type RequestDuplicateRule } from '@/lib/salary/tender-duplicates';
import { validateConfigValue } from '@/lib/salary/config';

// Значения = сид миграции 20261030_request_duplicate_statuses.sql.
const RULE: RequestDuplicateRule = { duplicate_statuses: ['dubl-zayavki', 'dubliu-zaiavki'] };

describe('дубль заявки: оба кода статуса', () => {
    it('исключает дубль в НАШЕМ коде статуса (900387)', () => {
        const v = evaluateRequestDuplicate(
            { status: 'dubl-zayavki', managerComment: '27.10.2026 08:12 Матвеева Евгения: дубль заявки 43847.' },
            true,
            RULE,
        );
        expect(v.isDuplicate).toBe(true);
        expect(v.excluded).toBe(true);
        expect(v.referencedNumber).toBe('43847');
    });

    it('исключает дубль в СТАРОМ коде статуса — закрытые периоды не едут', () => {
        const v = evaluateRequestDuplicate(
            { status: 'dubliu-zaiavki', managerComment: 'дубль 53686, клиент прислал заявку дважды' },
            true,
            RULE,
        );
        expect(v.excluded).toBe(true);
    });

    it('чужой статус — не дубль вовсе', () => {
        const v = evaluateRequestDuplicate(
            { status: 'send-assembling', managerComment: 'дубль 53686, причина' },
            true,
            RULE,
        );
        expect(v.isDuplicate).toBe(false);
        expect(v.excluded).toBe(false);
    });

    it('дубль без номера эталона остаётся в конверсии', () => {
        const v = evaluateRequestDuplicate({ status: 'dubl-zayavki', managerComment: 'дубль' }, false, RULE);
        expect(v.isDuplicate).toBe(true);
        expect(v.excluded).toBe(false);
    });

    it('эталон не найден — дубль остаётся в конверсии', () => {
        const v = evaluateRequestDuplicate(
            { status: 'dubl-zayavki', managerComment: 'дубль 999999, повтор заявки' },
            false,
            RULE,
        );
        expect(v.excluded).toBe(false);
    });
});

describe('конфиг правила', () => {
    it('читает список кодов', () => {
        const v = validateConfigValue('request_duplicate_rule', {
            duplicate_statuses: ['dubl-zayavki', 'dubliu-zaiavki'],
        });
        expect(v.duplicate_statuses).toEqual(['dubl-zayavki', 'dubliu-zaiavki']);
    });

    it('старую запись одним кодом читает как список из одного', () => {
        const v = validateConfigValue('request_duplicate_rule', { duplicate_status: 'dubliu-zaiavki' });
        expect(v.duplicate_statuses).toEqual(['dubliu-zaiavki']);
    });

    it('пустой список не принимает — правило без статуса не работает молча', () => {
        expect(() => validateConfigValue('request_duplicate_rule', { duplicate_statuses: [] })).toThrow();
    });
});
