/**
 * Письма Артёма читают заказ из колонок. Помощники (постоянный клиент,
 * юрлицо, адрес почты) должны отвечать одинаково и на колонках, и на старом
 * raw_payload — иначе при переходе поменялось бы поведение рассылки.
 */
import { describe, it, expect } from 'vitest';
import { orderShape, isKnownClient, isLegalEntity, extractCustomerEmail } from '@/lib/sales-bot/outreach';

const payload = {
    customer: { id: 5, ordersCount: 3, email: 'client@example.ru', contragent: { contragentType: 'legal-entity' } },
    contact: { email: 'contact@example.ru', firstName: 'Иван' },
    email: 'order@example.ru',
    firstName: 'Иван',
};

describe('заказ из колонок против старого JSON', () => {
    const fromColumns = orderShape({
        customer: payload.customer,
        contact: payload.contact,
        contragent: null,
        email: payload.email,
        firstName: payload.firstName,
    });
    const fromJson = orderShape({ raw_payload: payload });

    it('постоянный клиент определяется одинаково', () => {
        expect(isKnownClient(fromColumns)).toBe(isKnownClient(fromJson));
        expect(isKnownClient(fromColumns)).toBe(true);
    });

    it('юрлицо определяется одинаково', () => {
        expect(isLegalEntity(fromColumns)).toBe(isLegalEntity(fromJson));
        expect(isLegalEntity(fromColumns)).toBe(true);
    });

    it('адрес почты выбирается одинаково', () => {
        expect(extractCustomerEmail(fromColumns)).toBe(extractCustomerEmail(fromJson));
        expect(extractCustomerEmail(fromColumns)).toBe('client@example.ru');
    });

    it('разовый заказчик не считается постоянным', () => {
        expect(isKnownClient(orderShape({ customer: { ordersCount: 1 } }))).toBe(false);
    });
});
