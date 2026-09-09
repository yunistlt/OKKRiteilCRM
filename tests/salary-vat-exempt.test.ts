import { describe, expect, it } from 'vitest';
import { computeOrderFinance, isVatExemptContragent, resolveVatPct } from '@/lib/salary/metrics';

const POLICY = {
    default_vat_pct: 5,
    exempt_sites: ['ao-zvto'],
    exempt_contragent_markers: ['Беларусь', 'Минск', 'Минский', 'УНН', 'Казахстан', 'Астана'],
};
const RULES = [
    { vat_pct: 0, divisor: 1 },
    { vat_pct: 5, divisor: 1.05 },
    { vat_pct: 20, divisor: 1.2 },
];

// Реальные реквизиты из боевых заказов (сокращены).
const BELARUS = {
    legalName: 'Общество с ограниченной ответственностью «Оборудованиеторг»  УНН 690456473',
    legalAddress: '223021, Минский район, 500 м восточнее д. Богатырёво',
    bank: 'ОАО «Технобанк» г.Минск',
};
const ALTAI = {
    legalName: 'Общество с ограниченной ответственностью «ПАРК СЕМЕЙНЫХ ПРИКЛЮЧЕНИЙ»',
    legalAddress: '649100, РЕСПУБЛИКА АЛТАЙ, М.Р-Н МАЙМИНСКИЙ, С.П. МАНЖЕРОКСКОЕ',
    bank: 'Горно-Алтайское отделение № 8558 ПАО Сбербанк',
};
const LUNNAYA = {
    legalName: 'Общество с ограниченной ответственностью “АЛЬТАИР”',
    legalAddress: '142000, Московская обл., г. Домодедово, ул. Лунная, дом 35',
    bank: 'ПАО "СБЕРБАНК РОССИИ"',
};

describe('НДС 0% по иностранному контрагенту', () => {
    it('узнаёт белорусского контрагента', () => {
        expect(isVatExemptContragent(BELARUS, POLICY.exempt_contragent_markers)).toBe(true);
    });

    it('не путает МАЙМИНСКИЙ с Минском', () => {
        expect(isVatExemptContragent(ALTAI, POLICY.exempt_contragent_markers)).toBe(false);
    });

    it('не путает «Лунная» с УНН', () => {
        expect(isVatExemptContragent(LUNNAYA, POLICY.exempt_contragent_markers)).toBe(false);
    });

    it('без контрагента и без маркеров — обычная ставка', () => {
        expect(isVatExemptContragent(null, POLICY.exempt_contragent_markers)).toBe(false);
        expect(isVatExemptContragent(BELARUS, [])).toBe(false);
    });

    it('ставка: экспорт → 0, витрина ЗВТО → 0, остальное → default', () => {
        expect(resolveVatPct('zmktlt-ru-admin', POLICY, BELARUS)).toBe(0);
        expect(resolveVatPct('ao-zvto', POLICY, null)).toBe(0);
        expect(resolveVatPct('zmktlt-ru-admin', POLICY, LUNNAYA)).toBe(5);
    });

    it('заказ 54092: выручка без НДС = сумме счёта, НДС не вычитается', () => {
        const items = [{ quantity: 2, initialPrice: 72568, prices: [{ price: 65200 }] }];
        const exempt = computeOrderFinance(items, resolveVatPct('zmktlt-ru-admin', POLICY, BELARUS), RULES);
        expect(Math.round(exempt.revenueNoVat)).toBe(130400);
        const russian = computeOrderFinance(items, resolveVatPct('zmktlt-ru-admin', POLICY, LUNNAYA), RULES);
        expect(Math.round(russian.revenueNoVat)).toBe(124190);
    });
});
