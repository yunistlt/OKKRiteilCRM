/**
 * Письма, которые врут о своей кодировке (заказ 53005, 27.10.2026).
 */
import { describe, it, expect } from 'vitest';
import { fixCharsetMojibake } from '@/lib/email/mojibake';

describe('fixCharsetMojibake', () => {
    it('чинит письмо, где windows-1251 объявлен как koi8-r', () => {
        const broken = 'оНКЭГНБЮРЕКЭ лЮПЬЕБЮ йПХЯРХМЮ УНРЕК АШ НРНГБЮРЭ ЯННАЫЕМХЕ';
        const fixed = fixCharsetMojibake(broken);
        expect(fixed).toContain('Пользователь');
        expect(fixed).toContain('отозвать');
    });

    it('не трогает нормальный русский текст', () => {
        const good = 'Добрый день. Счёт был оплачен 14.04, ждём от вас отгрузку.';
        expect(fixCharsetMojibake(good)).toBe(good);
    });

    it('не портит длинное живое письмо, где каша случайно набирает совпадений', () => {
        const good = [
            'Добрый день.',
            'Напомните, сборка входит в стоимость?',
            'Присылайте спецификацию и счет на оплату, мы согласуем с руководством.',
            'С уважением, отдел снабжения.',
        ].join('\n\n');
        expect(fixCharsetMojibake(good)).toBe(good);
    });

    it('не трогает латиницу и пустое', () => {
        expect(fixCharsetMojibake('Hello, invoice attached')).toBe('Hello, invoice attached');
        expect(fixCharsetMojibake(null)).toBeNull();
    });
});
