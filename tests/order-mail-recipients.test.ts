/**
 * Получатели письма: «ответить всем» и копия.
 *
 * Автоприём сохранял только первый адрес «Кому» и не сохранял «Копию» вовсе —
 * переписка с несколькими людьми со стороны клиента выглядела разговором с
 * одним (09.10.2026).
 */
import { describe, it, expect } from 'vitest';
import { othersInConversation as othersOf } from '@/lib/order-mail/recipients';

describe('ответить всем', () => {
    it('берёт тех, кто стоял в копии', () => {
        expect(othersOf({
            from: 'snab@client.ru',
            toAll: ['rop@zmktlt.ru'],
            cc: ['buh@client.ru', 'boss@client.ru'],
        })).toEqual(['buh@client.ru', 'boss@client.ru']);
    });

    it('наш ящик в копию не ставит — мы и так отправитель', () => {
        expect(othersOf({ from: 'snab@client.ru', toAll: ['rop@zmktlt.ru'], cc: [] })).toEqual([]);
    });

    it('отправителя не дублирует: он уже в «Кому»', () => {
        expect(othersOf({
            from: 'snab@client.ru',
            toAll: ['rop@zmktlt.ru', 'snab@client.ru'],
            cc: ['snab@client.ru'],
        })).toEqual([]);
    });

    it('письмо одному человеку кнопки не даёт', () => {
        expect(othersOf({ from: 'one@client.ru', toAll: ['rop@zmktlt.ru'], cc: [] })).toHaveLength(0);
    });
});
