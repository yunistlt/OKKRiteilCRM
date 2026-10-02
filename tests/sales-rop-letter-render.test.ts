import { describe, it, expect } from 'vitest';
import { renderLetterLine, renderLetter, decodeEntities } from '@/lib/sales-rop/letter-render';

/**
 * Письмо бота-РОПа в вебе. Бот пишет разметкой Telegram, и окно плана
 * показывало её как есть — менеджер читал «<a href=…>№53603</a>».
 */
describe('письмо бота-РОПа в интерфейсе', () => {
    it('номер заказа из ссылки RetailCRM ведёт в нашу карточку', () => {
        const line = '<a href="https://zmktlt.retailcrm.ru/orders/53603/edit">№53603</a> — 569 359 ₽ — АО «ВПО «Точмаш».';
        const segments = renderLetterLine(line);

        expect(segments[0]).toEqual({ kind: 'order', label: '№53603', order: '53603' });
        expect(segments[1]).toEqual({ kind: 'text', text: ' — 569 359 ₽ — АО «ВПО «Точмаш».' });
        // Ни одного тега в человеческом тексте не осталось.
        expect(segments.map((s) => (s.kind === 'text' ? s.text : s.label)).join('')).not.toContain('<');
    });

    it('ссылка на нашу карточку тоже понимается', () => {
        const segments = renderLetterLine('<a href="/orders?order=1019%D0%90">№1019А</a> — свой заказ');
        expect(segments[0]).toMatchObject({ kind: 'order', label: '№1019А' });
    });

    it('жирный текст и сущности превращаются в обычные буквы', () => {
        expect(renderLetterLine('<b>Итого:</b> 12 шт. &amp; 3 просрочки')).toEqual([
            { kind: 'text', text: 'Итого: 12 шт. & 3 просрочки' },
        ]);
        expect(decodeEntities('&lt;план&gt;')).toBe('<план>');
    });

    it('строки и пустые строки письма сохраняются', () => {
        const letter = '☀️ Доброе утро\n\n<a href="https://zmktlt.retailcrm.ru/orders/54632/edit">№54632</a> — 351 650 ₽';
        const lines = renderLetter(letter);

        expect(lines).toHaveLength(3);
        expect(lines[1]).toEqual([]);
        expect(lines[2][0]).toMatchObject({ kind: 'order', order: '54632' });
    });

    it('ссылка без номера в адресе берёт номер из текста', () => {
        const segments = renderLetterLine('<a href="https://example.com/x">№54910</a>');
        expect(segments[0]).toEqual({ kind: 'order', label: '№54910', order: '54910' });
    });
});
