import { describe, expect, it } from 'vitest';
import {
    buildThreads,
    normalizeSubject,
    parseReferences,
    quoteOffset,
    visibleBody,
    type MailMessage,
} from '@/lib/order-mail/thread';

/**
 * Письма для разбора берём сохранёнными: IMAP локально не работает (DPI), а
 * отлаживать сборку тредов на проде нельзя (ТЗ §8.2).
 */
const message = (over: Partial<MailMessage> & Pick<MailMessage, 'key' | 'direction'>): MailMessage => ({
    messageId: null,
    inReplyTo: null,
    references: [],
    subject: null,
    from: null,
    fromName: null,
    to: null,
    at: null,
    body: null,
    attachments: [],
    sourceId: null,
    read: true,
    ...over,
});

describe('нормализация темы', () => {
    it('снимает Re, Fwd и наш тег', () => {
        expect(normalizeSubject('Re: [#2/54905] Сушильный стеллаж')).toBe('Сушильный стеллаж');
        expect(normalizeSubject('FWD: Re: Re: Счёт')).toBe('Счёт');
        expect(normalizeSubject('Ответ: Заявка')).toBe('Заявка');
    });

    it('не трогает тему без префиксов', () => {
        expect(normalizeSubject('Запрос КП на стеллажи')).toBe('Запрос КП на стеллажи');
    });
});

describe('заголовок References', () => {
    it('разбирает цепочку и снимает скобки', () => {
        expect(parseReferences('<a@mail.ru> <B@Mail.RU>')).toEqual(['a@mail.ru', 'b@mail.ru']);
    });

    it('принимает массив и пустое значение', () => {
        expect(parseReferences(['<x@y>'])).toEqual(['x@y']);
        expect(parseReferences(null)).toEqual([]);
    });
});

describe('начало цитаты', () => {
    it('находит русскую отбивку', () => {
        const body = 'Добрый день! Подтверждаю.\n\n07.10.2026, Иван Петров писал(а):\n> исходный текст';
        const offset = quoteOffset(body);
        expect(offset).not.toBeNull();
        expect(body.slice(0, offset!).trim()).toBe('Добрый день! Подтверждаю.');
    });

    it('находит английскую отбивку', () => {
        const body = 'Ок\n\nOn Mon, 6 Oct 2026 at 10:00, Ivan wrote:\n> text';
        expect(body.slice(0, quoteOffset(body)!).trim()).toBe('Ок');
    });

    it('находит строки с угловой скобкой без отбивки', () => {
        const body = 'Спасибо\n> прошлое письмо';
        expect(body.slice(0, quoteOffset(body)!).trim()).toBe('Спасибо');
    });

    it('не режет письмо без цитаты', () => {
        expect(quoteOffset('Просто письмо без цитаты')).toBeNull();
    });

    it('не режет письмо, которое само начинается с цитаты', () => {
        expect(quoteOffset('> только цитата')).toBeNull();
    });

    it('отдаёт видимую часть отдельно от цитаты', () => {
        const m = message({ key: 'in:1', direction: 'in', body: 'Ответ\n\n> было' });
        const { text, quoted } = visibleBody(m);
        expect(text).toBe('Ответ');
        expect(quoted).toContain('> было');
    });
});

describe('сборка тредов', () => {
    it('держит цепочку по In-Reply-To даже при смене темы', () => {
        const threads = buildThreads([
            message({ key: 'out:1', direction: 'out', messageId: '<a@zmk>', subject: '[#2/900089] КП', at: '2026-10-06T09:00:00Z' }),
            message({ key: 'in:2', direction: 'in', inReplyTo: '<a@zmk>', subject: 'другая тема', at: '2026-10-06T10:00:00Z', from: 'client@mail.ru' }),
        ]);

        expect(threads).toHaveLength(1);
        expect(threads[0].messages.map((m) => m.key)).toEqual(['out:1', 'in:2']);
        expect(threads[0].subject).toBe('КП');
    });

    it('склеивает по теме, когда заголовков цепочки нет', () => {
        const threads = buildThreads([
            message({ key: 'in:1', direction: 'in', subject: 'Запрос стеллажей', at: '2026-10-05T09:00:00Z', from: 'a@mail.ru' }),
            message({ key: 'out:2', direction: 'out', subject: 'Re: [#2/900089] Запрос стеллажей', at: '2026-10-05T12:00:00Z' }),
        ]);

        expect(threads).toHaveLength(1);
        expect(threads[0].messages).toHaveLength(2);
    });

    it('разные разговоры не смешивает', () => {
        const threads = buildThreads([
            message({ key: 'in:1', direction: 'in', subject: 'Запрос стеллажей', at: '2026-10-05T09:00:00Z' }),
            message({ key: 'in:2', direction: 'in', subject: 'Рекламация по доставке', at: '2026-10-05T10:00:00Z' }),
        ]);

        expect(threads).toHaveLength(2);
    });

    it('состояние считает по последнему письму', () => {
        const waitingUs = buildThreads([
            message({ key: 'out:1', direction: 'out', subject: 'Тема', at: '2026-10-05T09:00:00Z' }),
            message({ key: 'in:2', direction: 'in', subject: 'Re: Тема', at: '2026-10-05T10:00:00Z' }),
        ]);
        expect(waitingUs[0].state).toBe('awaiting_us');

        const waitingClient = buildThreads([
            message({ key: 'in:1', direction: 'in', subject: 'Тема', at: '2026-10-05T09:00:00Z' }),
            message({ key: 'out:2', direction: 'out', subject: 'Re: Тема', at: '2026-10-05T11:00:00Z' }),
        ]);
        expect(waitingClient[0].state).toBe('awaiting_client');
    });

    it('закрытый руками тред остаётся закрытым и уходит вниз', () => {
        const messages = [
            message({ key: 'in:1', direction: 'in', subject: 'Старый разговор', at: '2026-10-07T10:00:00Z' }),
            message({ key: 'in:2', direction: 'in', subject: 'Свежий разговор', at: '2026-10-01T10:00:00Z' }),
        ];
        const threads = buildThreads(messages, new Set(['subj:старый разговор']));

        expect(threads[threads.length - 1].state).toBe('closed');
        expect(threads[0].subject).toBe('Свежий разговор');
    });

    it('непрочитанными считает только входящие', () => {
        const threads = buildThreads([
            message({ key: 'in:1', direction: 'in', subject: 'Тема', at: '2026-10-05T09:00:00Z', read: false, from: 'a@mail.ru' }),
            message({ key: 'out:2', direction: 'out', subject: 'Re: Тема', at: '2026-10-05T10:00:00Z', read: false }),
        ]);

        expect(threads[0].unread).toBe(1);
        expect(threads[0].participants).toEqual(['a@mail.ru']);
    });
});
