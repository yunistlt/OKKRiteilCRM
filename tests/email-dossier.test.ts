/**
 * Досье Катерины: извлечение номеров-кандидатов из письма (чистая функция, без БД).
 * Инцидент 04.08.2026 — тема «Новый заказ 1005469»: номер не проверялся в CRM, письмо ушло
 * в бухгалтерию как «существующая сделка», заявка потеряна.
 */
import { describe, it, expect } from 'vitest';
import { extractOrderCandidates } from '@/lib/email/dossier';

describe('extractOrderCandidates', () => {
    it('берёт номер из темы уведомления магазина', () => {
        expect(extractOrderCandidates('Новый заказ 1005469', '')).toContain('1005469');
    });

    it('находит номер по ключевому слову в теле', () => {
        expect(extractOrderCandidates('Документы', 'Просим оплатить счёт № 53759 до пятницы')).toContain('53759');
    });

    it('тема важнее тела и дубли не повторяются', () => {
        const res = extractOrderCandidates('Re: заказ 54112', 'по заказу 54112 уточнение');
        expect(res).toEqual(['54112']);
    });

    it('без цифр возвращает пусто', () => {
        expect(extractOrderCandidates('Коммерческое предложение', 'Здравствуйте, пришлите КП')).toEqual([]);
    });

    it('не берёт из тела случайные числа без ключевого слова', () => {
        expect(extractOrderCandidates('Запрос', 'ИНН 6321123456, телефон 89171234567')).toEqual([]);
    });
});
