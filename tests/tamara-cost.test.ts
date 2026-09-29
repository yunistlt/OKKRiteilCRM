/**
 * Расход чата Тамары. Две регрессии, обе стоили денег молча.
 *
 * 1. Ответы инструментов подавались таблицей только в ветке chat.completions,
 *    а рассуждающие модели (gpt-5.5, на которой чат и работает) ходят через
 *    Responses — там оставался JSON.stringify. Экономия была написана ровно
 *    там, где её никто не получал.
 * 2. Тарифа gpt-5.x не было в ai_model_pricing, поэтому cost_usd писался нулём
 *    и самая дорогая статья расхода в отчёте выглядела бесплатной.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolvePricingKey } from '@/lib/ai-usage';

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'lib/shtab/tamara.ts'), 'utf8');

describe('ответы инструментов подаются одинаково на обоих путях', () => {
    it('результат инструмента нигде не уходит к модели сырым JSON', () => {
        expect(SOURCE).not.toContain('JSON.stringify(result)');
    });

    it('и chat.completions, и Responses зовут formatToolResult', () => {
        const calls = SOURCE.match(/formatToolResult\(result\)/g) ?? [];
        expect(calls.length).toBe(2);
    });
});

describe('ключ кэша префикса', () => {
    it('проставляется на обоих путях — иначе реплики разговора не делят кэш', () => {
        const keys = SOURCE.match(/prompt_cache_key/g) ?? [];
        expect(keys.length).toBe(2);
    });

    it('ключ — это разговор, а не общий для всех: чужой контекст не префикс', () => {
        expect(SOURCE).toContain('`tamara-chat-${opts.conversationId}`');
    });
});

describe('тариф gpt-5.x находится', () => {
    // Ставки из биллинга OpenAI, посчитанные по фактическим токенам за 15 дней.
    const PRICING = {
        'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
        'gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
        'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
        'gpt-5.5': { input: 5, cached: 0.5, output: 30 },
    };

    it('датированная gpt-5.5 сводится к своему тарифу, а не остаётся без цены', () => {
        expect(resolvePricingKey('gpt-5.5-2026-04-23', PRICING)).toBe('gpt-5.5');
    });

    it('gpt-5.4-mini не сваливается в тариф gpt-5.4 — тот втрое дороже', () => {
        expect(resolvePricingKey('gpt-5.4-mini-2026-03-17', PRICING)).toBe('gpt-5.4-mini');
        expect(resolvePricingKey('gpt-5.4-2026-03-05', PRICING)).toBe('gpt-5.4');
    });
});
