import { describe, it, expect } from 'vitest';
import { orderContactFrom } from '@/lib/own-crm/order-contact';
import { plainLetters } from '@/lib/okk-consultant-assistant-tools';

describe('контакты заказа — один читатель', () => {
    it('берёт почту из заказа, когда она там есть', () => {
        const contact = orderContactFrom({ raw_payload: { email: 'zakaz@example.ru' } }, { email: 'card@example.ru' });
        expect(contact.email).toBe('zakaz@example.ru');
    });

    it('добирает почту из карточки клиента, если в заказе её нет', () => {
        const contact = orderContactFrom({ raw_payload: {} }, { email: 'card@example.ru' });
        expect(contact.email).toBe('card@example.ru');
    });

    it('телефон из карточки понимает и объектом, и строкой', () => {
        expect(orderContactFrom({}, { phones: [{ number: '79991234567' }] }).phone).toBe('79991234567');
        expect(orderContactFrom({}, { phones: ['79997654321'] }).phone).toBe('79997654321');
    });

    it('пустые значения не выдаёт за контакт', () => {
        const contact = orderContactFrom({ raw_payload: { email: '  ' } }, { phones: [] });
        expect(contact.email).toBeNull();
        expect(contact.phone).toBeNull();
    });
});

describe('ё и е — одна буква при поиске статуса', () => {
    it('«в просчёте» совпадает с «В просчете» с доски', () => {
        expect(plainLetters('в просчёте')).toBe(plainLetters('В просчете'));
    });

    it('лишние пробелы не мешают', () => {
        expect(plainLetters('  Передано   в производство ')).toBe('передано в производство');
    });
});
