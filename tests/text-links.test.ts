/**
 * Что в показанном тексте становится ссылкой.
 *
 * Ссылка на каталог в письме выглядела простым текстом, и менеджер решил, что
 * она не работает (12.10.2026).
 */
import { describe, it, expect } from 'vitest';
import { splitLinks } from '@/lib/text-links';

const links = (text: string) => splitLinks(text).filter((p): p is { href: string; label: string } => typeof p !== 'string');

describe('ссылки в показанном тексте', () => {
    it('адрес каталога', () => {
        expect(links('ПОСМОТРИТЕ НАШ КАТАЛОГ: https://okk.zmksoft.com/katalog')[0])
            .toEqual({ href: 'https://okk.zmksoft.com/katalog', label: 'https://okk.zmksoft.com/katalog' });
    });

    it('адрес с www — ссылка', () => {
        expect(links('сайт www.zmktlt.ru и всё')[0].href).toBe('https://www.zmktlt.ru');
    });

    it('голое слово с точкой ссылкой не делаем', () => {
        // Иначе «договор.pdf» и «паспорт.jpg» в тексте станут ссылками в никуда.
        expect(links('во вложении договор.pdf и паспорт.jpg')).toHaveLength(0);
    });

    it('почта — письмом', () => {
        expect(links('Пишите на rop@zmktlt.ru')[0].href).toBe('mailto:rop@zmktlt.ru');
    });

    it('точка в конце предложения не уезжает в адрес', () => {
        const [link] = links('Смотрите https://zmktlt.ru.');
        expect(link.label).toBe('https://zmktlt.ru');
        expect(splitLinks('Смотрите https://zmktlt.ru.').slice(-1)[0]).toBe('.');
    });

    it('текст без ссылок возвращается целиком', () => {
        expect(splitLinks('Добрый день, уточните сроки')).toEqual(['Добрый день, уточните сроки']);
    });
});
