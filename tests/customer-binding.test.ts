/**
 * Тесты привязки заявки к карточке клиента: lib/retailcrm/customer-binding.ts
 *
 * Правило: ИНН → привязать; название + почта/телефон → привязать; одно из двух — покупатель
 * не определён, карточку не заводим. Кейс-источник: ПромСтоун (заказ 54151, 8 карточек
 * одного клиента без ИНН, общий ящик srpm@srpm.ru ещё на 10 чужих юрлицах).
 */

import { describe, it, expect } from 'vitest';
import {
    normalizeCompanyName,
    normalizePhone,
    pickCustomerMatch,
    buildUnresolvedCustomerHint,
    type CorporateCandidate,
} from '@/lib/retailcrm/customer-binding';

const card = (id: number, name: string | null, ordersCount = 0, matchedBy: CorporateCandidate['matchedBy'] = ['почта']): CorporateCandidate =>
    ({ id, name, ordersCount, matchedBy });

describe('normalizeCompanyName', () => {
    it('ОПФ, кавычки, регистр и город не влияют', () => {
        const variants = ['ООО "ПромСтоун"', 'ООО «ПРОМСТОУН»', 'ПромСтоун, г.Уфа', 'ООО "ПромСтоун', 'ООО Промстоун',
            'Общество с ограниченной ответственностью «ПромСтоун»'];
        for (const v of variants) expect(normalizeCompanyName(v)).toBe('промстоун');
    });

    it('латинские двойники букв приводятся к кириллице', () => {
        expect(normalizeCompanyName('OOО «МАКИТА»')).toBe(normalizeCompanyName('ООО «Макита»'));
    });

    it('разные компании не склеиваются', () => {
        expect(normalizeCompanyName('ООО "Строй"')).not.toBe(normalizeCompanyName('ООО "Стройкомплект"'));
        expect(normalizeCompanyName('НПП АММА')).toBe('нппамма');
    });

    it('пустое и одна ОПФ дают пустую строку', () => {
        expect(normalizeCompanyName(null)).toBe('');
        expect(normalizeCompanyName('ООО')).toBe('');
    });
});

describe('normalizePhone', () => {
    it('любой формат → 10 цифр', () => {
        expect(normalizePhone('+7 (909) 348-777-8')).toBe('9093487778');
        expect(normalizePhone('8 909 348 77 78')).toBe('9093487778');
        expect(normalizePhone('79093487778')).toBe('9093487778');
        expect(normalizePhone('9093487778')).toBe('9093487778');
    });
    it('короткий или пустой — null', () => {
        expect(normalizePhone('274-01-84')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
    });
});

describe('pickCustomerMatch', () => {
    const promstone = [
        card(75010, 'ООО "ПромСтоун"', 1),
        card(12781, 'ООО "ПромСтоун"', 139),
        card(8703, 'ООО "ПРОМСТОУН"', 9),
        card(51910, 'ООО «АТК»', 1),
        card(14648, 'OOО «МАКИТА»', 5),
    ];

    it('название + почта: берём карточку с наибольшим числом заказов', () => {
        const m = pickCustomerMatch('ООО "ПромСтоун"', promstone);
        expect(m.chosen?.id).toBe(12781);
        expect(m.sameName.map((c) => c.id)).toEqual([12781, 8703, 75010]);
    });

    it('почта совпала, название другое — не привязываем', () => {
        expect(pickCustomerMatch('ООО "Ромашка"', promstone).chosen).toBeNull();
    });

    it('название есть, контактов нет — не привязываем', () => {
        expect(pickCustomerMatch('ООО "ПромСтоун"', []).chosen).toBeNull();
        expect(pickCustomerMatch('ООО "ПромСтоун"', [card(12781, 'ООО "ПромСтоун"', 139, [])]).chosen).toBeNull();
    });

    it('названия нет — не привязываем даже при одной карточке по контакту', () => {
        expect(pickCustomerMatch(null, [card(12781, 'ООО "ПромСтоун"', 139)]).chosen).toBeNull();
        expect(pickCustomerMatch('ООО', [card(12781, 'ООО', 139)]).chosen).toBeNull();
    });

    it('при равном числе заказов — старшая карточка', () => {
        const m = pickCustomerMatch('Макита', [card(14743, 'ООО «Макита»', 5), card(14648, 'OOО «МАКИТА»', 5)]);
        expect(m.chosen?.id).toBe(14648);
    });
});

describe('buildUnresolvedCustomerHint', () => {
    it('говорит, что совпало, и показывает похожие карточки', () => {
        const hint = buildUnresolvedCustomerHint({
            companyName: null,
            hasEmail: true,
            hasPhone: false,
            byContact: [card(12781, 'ООО "ПромСтоун"', 139), card(51910, 'ООО «АТК»', 1)],
            byName: [],
        });
        expect(hint).toContain('Покупатель не определён');
        expect(hint).toContain('карточка клиента не создана');
        expect(hint).toContain('только почта');
        expect(hint).toContain('12781 «ООО "ПромСтоун"» — совпала почта, название в заявке не распознано, заказов: 139');
        expect(hint).toContain('51910');
        expect(hint).not.toMatch(/дубл/i);
    });

    it('только название: похожие по названию, контакт другой', () => {
        const hint = buildUnresolvedCustomerHint({
            companyName: 'ООО "ПромСтоун"',
            hasEmail: false,
            hasPhone: false,
            byContact: [],
            byName: [card(12781, 'ООО "ПромСтоун"', 139, [])],
        });
        expect(hint).toContain('название «ООО "ПромСтоун"»');
        expect(hint).toContain('12781 «ООО "ПромСтоун"» — совпало название, контакт другой');
    });

    it('в подсказке не больше трёх карточек на признак', () => {
        const many = Array.from({ length: 6 }, (_, i) => card(100 + i, `Фирма ${i}`, i));
        const hint = buildUnresolvedCustomerHint({ hasEmail: true, hasPhone: true, byContact: many, byName: [] });
        expect(hint.match(/совпал/g)?.length).toBe(3);
        expect(hint).toContain('105 «Фирма 5»');
    });
});
