/**
 * Разбор получателей письма.
 *
 * Брали только первый адрес «Кому», «Копию» не брали вовсе. Проверяем на
 * настоящем письме: разбирает его тот же `mailparser`, что и в проде.
 */
import { describe, it, expect } from 'vitest';
import { simpleParser } from 'mailparser';
import { allAddresses } from '@/lib/email/imap';

const letter = [
    'From: Снабжение <snab@client.ru>',
    'To: rop@zmktlt.ru, Бухгалтерия <buh@client.ru>',
    'Cc: Начальник <boss@client.ru>, SNAB2@CLIENT.RU',
    'Subject: Re: [#1/54923] По заказу',
    'Message-ID: <abc@client.ru>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Добрый день! Уточните сроки.',
].join('\r\n');

describe('получатели письма', () => {
    it('берёт всех из «Кому», а не первого', async () => {
        const parsed = await simpleParser(Buffer.from(letter, 'utf8'));
        expect(allAddresses(parsed.to)).toEqual(['rop@zmktlt.ru', 'buh@client.ru']);
    });

    it('берёт «Копию» и приводит адреса к нижнему регистру', async () => {
        const parsed = await simpleParser(Buffer.from(letter, 'utf8'));
        expect(allAddresses(parsed.cc)).toEqual(['boss@client.ru', 'snab2@client.ru']);
    });

    it('письмо без копии даёт пустой список, а не падение', async () => {
        const plain = letter.split('\r\n').filter((line) => !line.startsWith('Cc:')).join('\r\n');
        const parsed = await simpleParser(Buffer.from(plain, 'utf8'));
        expect(allAddresses(parsed.cc)).toEqual([]);
    });
});
