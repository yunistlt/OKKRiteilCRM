/**
 * Изложение переписки — помощник, а не действие (ТЗ §6).
 *
 * Проверяем, что он собирает разговор из писем, не тащит цитаты и честно
 * отказывается, когда излагать нечего.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { prompt: '', answer: '{}', configured: true } }));

vi.mock('@/utils/openai', () => ({
    isOpenAIConfigured: () => state.configured,
    getOpenAIClient: () => ({
        chat: {
            completions: {
                create: async (params: any) => {
                    state.prompt = params.messages.map((m: any) => m.content).join('\n');
                    return { choices: [{ message: { content: state.answer } }] };
                },
            },
        },
    }),
}));

import { summarizeThread } from '@/lib/order-mail/summary';

const message = (direction: 'in' | 'out', body: string, at = '2026-10-01T10:00:00Z') => ({
    key: `${direction}:1`, direction, messageId: null, inReplyTo: null, references: [],
    subject: 'Заказ', from: 'client@x.ru', fromName: 'Снабжение', to: 'rop@zmktlt.ru',
    toAll: [], cc: [], at, body, attachments: [], sourceId: '1', read: true,
}) as any;

beforeEach(() => {
    state.answer = JSON.stringify({
        agreed: ['Цена 80 970 ₽ за шкаф', 'Оплата 70/30'],
        weOwe: ['Выслать договор'],
        nextStep: 'Отправить договор и счёт',
    });
    state.configured = true;
});

describe('изложение переписки', () => {
    it('собирает договорённости, долги и следующий шаг', async () => {
        const result = await summarizeThread([
            message('in', 'Добрый день! Почём шкаф сушильный и какие условия оплаты?'),
            message('out', 'Цена 80 970 ₽, оплата 70 на 30. Договор вышлем.'),
        ]);

        expect(result.agreed).toContain('Оплата 70/30');
        expect(result.weOwe).toEqual(['Выслать договор']);
        expect(result.nextStep).toBe('Отправить договор и счёт');
    });

    it('цитату прошлого письма в модель не тащит', async () => {
        await summarizeThread([
            message('in', 'Да, согласны.\n> Цена 80 970 ₽, оплата 70 на 30 — это старая цитата'),
            message('out', 'Отлично, готовим договор. Нужен ИНН.'),
        ]);

        expect(state.prompt).toContain('Да, согласны.');
        expect(state.prompt).not.toContain('старая цитата');
    });

    it('двух строк переписки мало — отказываемся словами', async () => {
        await expect(summarizeThread([message('in', 'Привет')])).rejects.toThrow('слишком мало');
    });

    it('без настроенного ИИ объясняет, а не падает', async () => {
        state.configured = false;
        await expect(summarizeThread([message('in', 'а'.repeat(200))])).rejects.toThrow('ИИ не настроен');
    });
});
