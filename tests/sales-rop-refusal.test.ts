/**
 * Отказ клиента снимает задачу — доработка №77.
 *
 * Жалоба Ирины Гордеевой 03.11.2026: «клиент сказал, что нет потребности в
 * нашей продукции, а задача приходит каждый день». Решение принимает РОП по
 * расшифровке разговора, поэтому проверяем две вещи: что машинная строка
 * разбирается и что её поломка не уносит с собой разбор дня.
 */
import { describe, it, expect } from 'vitest';
import { parseRefusals, formatRefusals, type AppliedRefusal } from '@/lib/sales-rop/refusal';

const applied = (over: Partial<AppliedRefusal> = {}): AppliedRefusal => ({
    orderNumber: '23281',
    phone: null,
    horizon: 'year',
    words: 'потребности в вашей продукции нет',
    clientKey: 'cust:38911',
    clientName: 'ООО "РАД"',
    nextContactAt: '2027-11-05',
    muted: false,
    skipped: null,
    ...over,
});

describe('разбор решений РОПа', () => {
    it('машинная строка не попадает в текст для человека', () => {
        const r = parseRefusals(
            'Четыре разговора, два с договорённостью.\n\nОТКАЗЫ: [{"заказ":"23281","горизонт":"год","слова":"не нужно"}]',
        );
        expect(r.text).toBe('Четыре разговора, два с договорённостью.');
        expect(r.refusals).toEqual([
            { orderNumber: '23281', phone: null, horizon: 'year', words: 'не нужно' },
        ]);
    });

    it('строки нет вовсе — отказов нет, разбор остаётся', () => {
        const r = parseRefusals('День прошёл ровно.');
        expect(r.refusals).toEqual([]);
        expect(r.text).toBe('День прошёл ровно.');
    });

    it('«ОТКАЗЫ: нет» — не повод терять разбор дня', () => {
        const r = parseRefusals('День прошёл ровно.\nОТКАЗЫ: нет');
        expect(r.refusals).toEqual([]);
        expect(r.text).toBe('День прошёл ровно.');
    });

    it('непонятный горизонт — самая короткая отсрочка', () => {
        const r = parseRefusals('итог\nОТКАЗЫ: [{"телефон":"+74959632722","горизонт":"когда-нибудь","слова":"позже"}]');
        expect(r.refusals[0].horizon).toBe('season');
        expect(r.refusals[0].orderNumber).toBeNull();
    });

    it('без слов клиента решение не применяется', () => {
        const r = parseRefusals('итог\nОТКАЗЫ: [{"заказ":"23281","горизонт":"год"}]');
        expect(r.refusals).toEqual([]);
    });

    it('без заказа и без телефона привязать не к кому', () => {
        const r = parseRefusals('итог\nОТКАЗЫ: [{"горизонт":"год","слова":"не нужно"}]');
        expect(r.refusals).toEqual([]);
    });
});

describe('строка в разбор вечера', () => {
    it('называет клиента, его слова и дату возврата', () => {
        expect(formatRefusals([applied()])).toBe(
            'Отказы в разговорах:\n'
                + '• ООО "РАД" (заказ №23281) — «потребности в вашей продукции нет». Вернусь 05.11.2027.',
        );
    });

    it('«никогда» — снят с ритма, без даты', () => {
        const text = formatRefusals([applied({ horizon: 'never', muted: true })]);
        expect(text).toContain('Снял с ритма');
        expect(text).not.toContain('Вернусь');
    });

    it('не смог привязать — говорит об этом, а не молчит', () => {
        expect(formatRefusals([applied({ skipped: 'клиента не нашли', clientName: '' })])).toContain(
            'Не отложил: клиента не нашли',
        );
    });

    it('отказов нет — строки нет', () => {
        expect(formatRefusals([])).toBe('');
    });
});
