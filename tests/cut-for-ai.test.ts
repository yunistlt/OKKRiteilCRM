import { describe, expect, it } from 'vitest';
import { cutForAi } from '@/lib/email/classify';

/**
 * Обрезка текста перед отправкой в разбор.
 *
 * Повод: письмо с эмодзи семь часов висело неразобранным. Обычный `slice`
 * разрубил эмодзи пополам, половинка сломала запрос, и воркер повторял его
 * бесконечно (05.10.2026).
 */
describe('cutForAi', () => {
    it('не разрубает эмодзи на границе', () => {
        const text = 'абв💙где';
        const cut = cutForAi(text, 4);
        expect(cut).toBe('абв💙');
        expect([...cut].every((ch) => {
            const code = ch.codePointAt(0)!;
            return code < 0xD800 || code > 0xDFFF;
        })).toBe(true);
    });

    it('убирает одиночный суррогат, если он был в самом тексте', () => {
        const broken = 'привет\uD83D конец';
        expect(cutForAi(broken, 100)).toBe('привет конец');
    });

    it('не трогает текст короче предела', () => {
        expect(cutForAi('короткий', 100)).toBe('короткий');
    });

    it('переживает пустое значение', () => {
        expect(cutForAi(null, 10)).toBe('');
        expect(cutForAi(undefined, 10)).toBe('');
    });
});
