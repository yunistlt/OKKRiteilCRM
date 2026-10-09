/**
 * Ссылки в письме кликабельные.
 *
 * Ответ менеджера собирается построчно в абзацы, адрес оставался текстом и в
 * почте у клиента не нажимался (Лена Парфёнова 09.10.2026 про ссылку на
 * каталог).
 */
import { describe, it, expect } from 'vitest';
import { linkifyHtml } from '@/lib/html-links';

describe('ссылки в письме', () => {
    it('адрес сайта становится ссылкой', () => {
        const out = linkifyHtml('<p>Каталог: https://okk.zmksoft.com/katalog</p>');
        expect(out).toBe('<p>Каталог: <a href="https://okk.zmksoft.com/katalog">https://okk.zmksoft.com/katalog</a></p>');
    });

    it('адрес без протокола тоже', () => {
        expect(linkifyHtml('<p>www.zmktlt.ru</p>')).toContain('href="https://www.zmktlt.ru"');
    });

    it('почта становится письмом', () => {
        expect(linkifyHtml('<p>Пишите: rop@zmktlt.ru</p>')).toContain('href="mailto:rop@zmktlt.ru"');
    });

    it('точка в конце предложения не уезжает в адрес', () => {
        const out = linkifyHtml('<p>Смотрите https://okk.zmksoft.com/katalog.</p>');
        expect(out).toContain('href="https://okk.zmksoft.com/katalog"');
        expect(out).toContain('</a>.');
    });

    it('готовую ссылку не трогаем — ссылки в ссылке не будет', () => {
        const html = '<a href="https://okk.zmksoft.com/katalog">ПОСМОТРИТЕ НАШ КАТАЛОГ</a>';
        expect(linkifyHtml(html)).toBe(html);
    });

    it('кнопку каталога из подписи не ломает', () => {
        const html = '<a href="https://okk.zmksoft.com/katalog" style="background:#1d4ed8">КАТАЛОГ</a><br>rop@zmktlt.ru';
        const out = linkifyHtml(html);
        expect(out.match(/<a /g)).toHaveLength(2);
        expect(out).toContain('mailto:rop@zmktlt.ru');
    });
});
