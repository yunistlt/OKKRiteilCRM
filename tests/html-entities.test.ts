import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToPlainText } from '@/lib/html-entities';

describe('коды HTML в письмах', () => {
    it('числовые коды становятся русским текстом', () => {
        // Доработка №91: письмо от Ruselt по заказу 900475 приходило кодами и
        // читалось как «&#1047;&#1076;...».
        expect(decodeEntities('&#1047;&#1076;&#1088;&#1072;&#1074;&#1089;&#1090;&#1074;&#1091;&#1081;&#1090;&#1077;'))
            .toBe('Здравствуйте');
    });

    it('шестнадцатеричные коды тоже', () => {
        expect(decodeEntities('&#x417;&#x434;&#x440;')).toBe('Здр');
    });

    it('названия кодов, которых раньше не знали', () => {
        expect(decodeEntities('&laquo;СХК&raquo; &mdash; 402&nbsp;400&nbsp;&rub;'))
            .toBe('«СХК» — 402 400 ₽');
    });

    it('незнакомый код остаётся как есть — лучше код, чем пустота', () => {
        expect(decodeEntities('&nosuchthing; &#99999999999;')).toBe('&nosuchthing; &#99999999999;');
    });

    it('из HTML-письма получается читаемый текст без тегов', () => {
        const html = '<html><style>p{color:red}</style><body><p>&#1055;&#1088;&#1080;&#1074;&#1077;&#1090;</p>'
            + '<p>&#1057;&#1091;&#1084;&#1084;&#1072;: 402&nbsp;400 &#1088;&#1091;&#1073;.</p></body></html>';
        expect(htmlToPlainText(html)).toBe('Привет\nСумма: 402 400 руб.');
    });
});
