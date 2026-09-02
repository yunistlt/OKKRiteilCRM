/**
 * Поиск тарифа по имени модели. Регрессия: OpenAI отдаёт датированную версию
 * («gpt-4o-mini-2024-07-18»), тарифы заведены на семейство — из-за прямого
 * поиска по ключу стоимость всех вызовов писалась нулём.
 */
import { describe, it, expect } from 'vitest';
import { resolvePricingKey } from '@/lib/ai-usage';

const PRICING = {
    'gpt-4o': { input: 2.5, cached: 1.25, output: 10 },
    'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
    'gpt-4.1': { input: 2, cached: 0.5, output: 8 },
    'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
    'text-embedding-3-small': { input: 0.02, cached: 0, output: 0 },
};

describe('поиск тарифа модели', () => {
    it('датированная версия сводится к семейству', () => {
        expect(resolvePricingKey('gpt-4o-mini-2024-07-18', PRICING)).toBe('gpt-4o-mini');
    });

    it('точное имя берётся как есть', () => {
        expect(resolvePricingKey('gpt-4o', PRICING)).toBe('gpt-4o');
        expect(resolvePricingKey('text-embedding-3-small', PRICING)).toBe('text-embedding-3-small');
    });

    it('выбирается САМЫЙ ДЛИННЫЙ подходящий тариф, а не первый попавшийся', () => {
        // «gpt-4o-mini-…» не должен свалиться в тариф «gpt-4o» — он вчетверо дороже
        expect(resolvePricingKey('gpt-4o-mini-2030-01-01', PRICING)).toBe('gpt-4o-mini');
        expect(resolvePricingKey('gpt-4.1-mini-2025-04-14', PRICING)).toBe('gpt-4.1-mini');
    });

    it('незнакомая модель тарифа не получает (стоимость останется нулевой)', () => {
        expect(resolvePricingKey('claude-opus-5', PRICING)).toBeNull();
        expect(resolvePricingKey('unknown', PRICING)).toBeNull();
    });
});
