import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculationsForOrder, calcLinkConfigured } from '@/lib/own-crm/calc-link';

/**
 * Связь карточки заказа с калькулятором «Бот-Инженер». Сеть здесь не трогаем:
 * проверяем решения, которые принимаются до запроса — чтобы «Б/Н» никогда не
 * считался номером заказа, а отсутствие ключей объяснялось человеку словами.
 */
describe('расчёты калькулятора по номеру заказа', () => {
    const url = process.env.LVZ_SUPABASE_URL;
    const key = process.env.LVZ_SUPABASE_ANON_KEY;

    beforeEach(() => {
        delete process.env.LVZ_SUPABASE_URL;
        delete process.env.LVZ_SUPABASE_ANON_KEY;
    });

    afterEach(() => {
        if (url) process.env.LVZ_SUPABASE_URL = url;
        else delete process.env.LVZ_SUPABASE_URL;
        if (key) process.env.LVZ_SUPABASE_ANON_KEY = key;
        else delete process.env.LVZ_SUPABASE_ANON_KEY;
    });

    it('без ключей честно говорит, что калькулятор не подключён', async () => {
        expect(calcLinkConfigured()).toBe(false);
        const result = await calculationsForOrder('52709');
        expect(result.available).toBe(false);
        if (!result.available) {
            expect(result.reason).toContain('LVZ_SUPABASE_URL');
        }
        expect(result.items).toEqual([]);
    });

    it('«Б/Н» — это не номер заказа: такие расчёты не ищем даже с ключами', async () => {
        process.env.LVZ_SUPABASE_URL = 'https://example.supabase.co';
        process.env.LVZ_SUPABASE_ANON_KEY = 'test-key';

        const result = await calculationsForOrder('Б/Н');
        expect(result.available).toBe(true);
        expect(result.items).toEqual([]);
    });

    it('пустой номер заказа не превращается в запрос', async () => {
        process.env.LVZ_SUPABASE_URL = 'https://example.supabase.co';
        process.env.LVZ_SUPABASE_ANON_KEY = 'test-key';

        for (const number of ['', '   ']) {
            const result = await calculationsForOrder(number);
            expect(result.available).toBe(true);
            expect(result.items).toEqual([]);
        }
    });
});
