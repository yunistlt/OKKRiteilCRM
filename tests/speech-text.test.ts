import { describe, it, expect } from 'vitest';
import { normalizeForSpeech, intToWordsRu, rublesToWordsRu, plural } from '@/lib/speech-text';

describe('plural', () => {
    it('выбирает форму по последней цифре', () => {
        const f: [string, string, string] = ['заказ', 'заказа', 'заказов'];
        expect(plural(1, f)).toBe('заказ');
        expect(plural(2, f)).toBe('заказа');
        expect(plural(5, f)).toBe('заказов');
        expect(plural(21, f)).toBe('заказ');
        expect(plural(42, f)).toBe('заказа');
    });

    it('11..19 — всегда форма множественного числа', () => {
        const f: [string, string, string] = ['заказ', 'заказа', 'заказов'];
        for (const n of [11, 12, 14, 19, 111, 112]) expect(plural(n, f)).toBe('заказов');
    });
});

describe('intToWordsRu', () => {
    it('разряды и род', () => {
        expect(intToWordsRu(0)).toBe('ноль');
        expect(intToWordsRu(21)).toBe('двадцать один');
        expect(intToWordsRu(21, true)).toBe('двадцать одна');
        expect(intToWordsRu(1000)).toBe('одна тысяча');
        expect(intToWordsRu(2_140_000)).toBe('два миллиона сто сорок тысяч');
        expect(intToWordsRu(-5)).toBe('минус пять');
    });

    it('пропускает нулевые триады', () => {
        expect(intToWordsRu(1_000_007)).toBe('один миллион семь');
    });
});

describe('rublesToWordsRu', () => {
    it('согласует рубли и копейки', () => {
        expect(rublesToWordsRu(1)).toBe('один рубль');
        expect(rublesToWordsRu(2)).toBe('два рубля');
        expect(rublesToWordsRu(5)).toBe('пять рублей');
        expect(rublesToWordsRu(1250.4)).toBe('одна тысяча двести пятьдесят рублей сорок копеек');
    });
});

describe('normalizeForSpeech', () => {
    it('склеивает разряды, поставленные formatNumberRu (неразрывный пробел)', () => {
        // Именно так выглядит вывод formatNumberRu — U+00A0 и U+202F.
        expect(normalizeForSpeech('Выручка 2 140 000 ₽'))
            .toBe('Выручка два миллиона сто сорок тысяч рублей');
        expect(normalizeForSpeech('План 2 000 000 руб.'))
            .toBe('План два миллиона рублей');
    });

    it('проценты: один знак читает десятыми, два — сотыми', () => {
        expect(normalizeForSpeech('на 8% выше')).toBe('на восемь процентов выше');
        expect(normalizeForSpeech('на 3,5%')).toBe('на три целых пять десятых процента');
        expect(normalizeForSpeech('на 3,05%')).toBe('на три целых пять сотых процента');
    });

    it('даты — в родительном падеже, текущий год не произносит', () => {
        const year = new Date().getFullYear();
        expect(normalizeForSpeech(`с ${year}-09-21`)).toBe('с двадцать первого сентября');
        expect(normalizeForSpeech('21.12.2025 обсуждали'))
            .toBe('двадцать первого декабря две тысячи двадцать пятого года обсуждали');
    });

    it('номер заказа читает цифрами, чтобы сверить со экраном', () => {
        expect(normalizeForSpeech('Заказ №53971')).toBe('Заказ номер пять три девять семь один');
    });

    it('время', () => {
        expect(normalizeForSpeech('в 14:30')).toBe('в четырнадцать тридцать');
        expect(normalizeForSpeech('в 9:00')).toBe('в девять ноль-ноль');
    });

    it('снимает разметку, которую голосом не передать', () => {
        expect(normalizeForSpeech('**Сводка** за неделю')).toBe('Сводка за неделю');
        expect(normalizeForSpeech('- пункт списка')).toBe('пункт списка');
        expect(normalizeForSpeech('## Заголовок')).toBe('Заголовок');
        expect(normalizeForSpeech('см. [отчёт](https://okk.zmksoft.com/x)')).toBe('см. отчёт');
        expect(normalizeForSpeech('код `x = 1` тут')).toBe('код x = один тут');
    });

    it('пустой вход не падает', () => {
        expect(normalizeForSpeech('')).toBe('');
    });

    it('не ломает текст без чисел', () => {
        expect(normalizeForSpeech('Жду вашего решения.')).toBe('Жду вашего решения.');
    });
});
