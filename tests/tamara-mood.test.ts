import { describe, expect, it } from 'vitest';
import { moodOf } from '@/lib/shtab/tamara-mood';

// Реплики — из настоящей переписки владельца с Тамарой.
describe('moodOf', () => {
    it('приветствие', () => {
        expect(moodOf('Привет Тамара')).toBe('greet');
        expect(moodOf('Привет Тамара\nДа уже с утра разгребал косяки с кодом ))')).toBe('greet');
    });

    it('комплимент', () => {
        expect(moodOf('ты прелесть')).toBe('pleased');
        expect(moodOf('ты такая умная )')).toBe('pleased');
        expect(moodOf('отлично , мне нужен пдф , сладкая')).toBe('pleased');
    });

    it('про наряд — кружится', () => {
        expect(moodOf('покрутись')).toBe('twirl');
        expect(moodOf('Красивое платье!')).toBe('twirl');
        expect(moodOf('красавица, покажи наряд')).toBe('twirl');
        expect(moodOf('Привет, классный костюм')).toBe('greet');
        expect(moodOf('Сделай отчёт по продажам костюмов спецодежды за месяц и пришли пдф с разбивкой по менеджерам')).toBe(
            'explain',
        );
    });

    it('поручение ласковым словом — это дело, а не комплимент', () => {
        expect(
            moodOf(
                'Солнце, посмотри пожалуйста с точки зрения финансового директора сейчас у нас продажи, выручка и поступление денег',
            ),
        ).toBe('explain');
    });

    it('обычный вопрос', () => {
        expect(moodOf('сколько сегодня заказов было выпущено с производства?')).toBe('explain');
        expect(moodOf('Заказ 54789 проверь его')).toBe('explain');
    });
});
