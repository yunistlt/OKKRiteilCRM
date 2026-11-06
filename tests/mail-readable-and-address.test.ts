/**
 * Две жалобы из реестра доработок (06.11.2026, Ирина Гордеева):
 *  - №83: входящее по заказу 900475 «не читается»;
 *  - №84: письмо по заказу 900454 клиенту не дошло.
 *
 * Причины разные, а корень один — письмо показывали и отправляли как есть, не
 * глядя, что в нём написано и кому оно уйдёт.
 */
import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, htmlToPlainText } from '@/lib/email/html-text';
import { isNoReplyAddress, othersInConversation } from '@/lib/order-mail/recipients';

describe('письмо читается', () => {
    it('кириллица числовыми сущностями разворачивается в слова', () => {
        // Так пришло письмо от d5@ruselt.ru по заказу 900475.
        expect(decodeHtmlEntities('&#1047;&#1076;&#1088;&#1072;&#1074;&#1089;&#1090;&#1074;&#1091;&#1081;&#1090;&#1077;'))
            .toBe('Здравствуйте');
    });

    it('понимает шестнадцатеричную запись и ходовые именованные', () => {
        // `&nbsp;` — неразрывный пробел: в тексте письма он так и остаётся.
        expect(decodeHtmlEntities('&#x417;&nbsp;&mdash;&laquo;&raquo;')).toBe('З —«»');
    });

    it('незнакомую сущность оставляет как есть, а не съедает', () => {
        expect(decodeHtmlEntities('цена &bdquo;пример')).toBe('цена &bdquo;пример');
    });

    it('тело письма превращается в текст уже расшифрованным', () => {
        const html = '<div>&#1062;&#1077;&#1085;&#1072;: 81&nbsp;000 &#8381;</div>';
        expect(htmlToPlainText(html)).toBe('Цена: 81 000 ₽');
    });

    it('не разбирает сущности в теги', () => {
        expect(htmlToPlainText('<p>&lt;b&gt;жирный&lt;/b&gt;</p>')).toBe('<b>жирный</b>');
    });
});

describe('письмо уходит человеку, а не роботу', () => {
    it('узнаёт ящики уведомлений', () => {
        expect(isNoReplyAddress('noreply@webasyst.biz')).toBe(true);
        expect(isNoReplyAddress('no-reply@site.ru')).toBe(true);
        expect(isNoReplyAddress('DoNotReply@Example.COM')).toBe(true);
        expect(isNoReplyAddress('mailer-daemon@yandex.ru')).toBe(true);
    });

    it('живые адреса не трогает', () => {
        expect(isNoReplyAddress('mo.nefedkin@russturbo.ru')).toBe(false);
        expect(isNoReplyAddress('d5@ruselt.ru')).toBe(false);
        // Человек, в фамилии которого есть «reply», тоже человек.
        expect(isNoReplyAddress('replyako@mail.ru')).toBe(false);
        expect(isNoReplyAddress('')).toBe(false);
    });

    it('«ответить всем» не ставит робота в копию', () => {
        const others = othersInConversation({
            from: 'noreply@webasyst.biz',
            toAll: ['rop@zmktlt.ru', 'mo.nefedkin@russturbo.ru'],
            cc: ['noreply@webasyst.biz', 'buh@russturbo.ru'],
        });
        expect(others).toEqual(['mo.nefedkin@russturbo.ru', 'buh@russturbo.ru']);
    });
});
