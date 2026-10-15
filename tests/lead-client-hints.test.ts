/**
 * Заявки всех служб (почта, виджет, звонок) заводятся у нас, и карточку
 * клиента находит запись заказа — по ИНН и названию из этих признаков.
 * До 15.10.2026 контрагента заводили в RetailCRM, и у своих заказов
 * покупатель оставался пустым.
 */
import { describe, it, expect } from 'vitest';
import { clientHintsForOrder } from '@/lib/own-crm/lead-client';

describe('признаки клиента для заявки', () => {
    it('ИНН и название едут в заказ — по ним ищется карточка', () => {
        const hints = clientHintsForOrder({ inn: '6321277326', companyName: 'ООО «ПОБТ»' }) as any;
        expect(hints.contragent.INN).toBe('6321277326');
        expect(hints.contragent.legalName).toBe('ООО «ПОБТ»');
        expect(hints.contragent.contragentType).toBe('legal-entity');
    });

    it('юридическое название приоритетнее названия из подписи', () => {
        const hints = clientHintsForOrder({ legalName: 'ООО «Ромашка»', companyName: 'Ромашка' }) as any;
        expect(hints.contragent.legalName).toBe('ООО «Ромашка»');
    });

    it('без ИНН и названия ничего не добавляем — пустой объект', () => {
        expect(clientHintsForOrder({ contactName: 'Иван' })).toEqual({});
        expect(clientHintsForOrder(null)).toEqual({});
    });
});
