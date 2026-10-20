/**
 * Разбор поискового запроса по каталогу: числа не теряются.
 *
 * Жалоба Ирины Гордеевой 20.10.2026: «поиск не ищет по обозначению, что
 * стеллаж именно на 12 пар нужен». Куски короче трёх знаков выбрасывались, и
 * «12» пропадало — выдавались стеллажи на 10 пар.
 */
import { describe, expect, it } from 'vitest';
import { catalogQueryParts } from '@/lib/shtab/lvz';

describe('разбор запроса по каталогу', () => {
    it('сохраняет количество пар', () => {
        const { words } = catalogQueryParts('сушильный стеллаж вираж эконом на 12 пар');
        expect(words).toContain('12');
        expect(words).toContain('пар');
        // Предлог в поиске не нужен.
        expect(words).not.toContain('на');
    });

    it('сохраняет любые числа, даже однозначные', () => {
        expect(catalogQueryParts('стеллаж на 8 пар').words).toContain('8');
        expect(catalogQueryParts('шкаф 40 пар').words).toContain('40');
    });

    it('не ломает разбор моделей', () => {
        const { models } = catalogQueryParts('шкаф сушильный ШСО-4-15 ЗМК Комфорт');
        expect(models).toContain('шсо-4-15');
    });
});
