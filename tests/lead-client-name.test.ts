import { describe, it, expect } from 'vitest';
import { sanitizeClientName } from '@/lib/leads/client-name';

describe('sanitizeClientName', () => {
    it('выбрасывает имя нашего бота, которое ИИ принял за имя клиента', () => {
        expect(sanitizeClientName('Елена')).toBeNull();
        expect(sanitizeClientName('елена')).toBeNull();
        expect(sanitizeClientName('Елена (ЗМК)')).toBeNull();
        expect(sanitizeClientName('Семён')).toBeNull();
        expect(sanitizeClientName('Катерина')).toBeNull();
    });

    it('выбрасывает заглушки и никнейм сессии', () => {
        expect(sanitizeClientName('Клиент из чата')).toBeNull();
        expect(sanitizeClientName('Лид')).toBeNull();
        expect(sanitizeClientName('  ')).toBeNull();
        expect(sanitizeClientName(null)).toBeNull();
        expect(sanitizeClientName('Весёлый синий кот', 'Весёлый синий кот')).toBeNull();
    });

    it('оставляет настоящее имя клиента', () => {
        expect(sanitizeClientName('  Антон ')).toBe('Антон');
        expect(sanitizeClientName('«Андрей»')).toBe('Андрей');
        expect(sanitizeClientName('Андрей Петрович')).toBe('Андрей Петрович');
    });
});
