import { describe, it, expect } from 'vitest';
import {
    evaluateEstimate,
    hasEstimateMarker,
    isEstimateReason,
    isVerdictConfirmed,
    type EstimateRule,
} from '@/lib/salary/estimates';

// Правило как в миграции 20260803_salary_estimate_exclusion.sql.
const RULE: EstimateRule = {
    statuses: ['soglasovanie-otmeny'],
    cancel_reasons: ['calc_rate'],
    comment_patterns: ['смет', 'бюджетир'],
    min_confidence: 0.7,
};

const order = (over: Partial<Parameters<typeof evaluateEstimate>[0]> = {}) => ({
    status: 'soglasovanie-otmeny',
    cancelReason: null,
    managerComment: null,
    customerComment: null,
    ...over,
});

describe('признаки сметы', () => {
    it('причина отмены опознаётся по коду из справочника', () => {
        expect(isEstimateReason({ cancelReason: 'calc_rate' }, RULE)).toBe(true);
        expect(isEstimateReason({ cancelReason: 'tender_loose' }, RULE)).toBe(false);
        expect(isEstimateReason({ cancelReason: null }, RULE)).toBe(false);
    });

    it('маркер ищется в обоих комментариях без учёта регистра', () => {
        expect(hasEstimateMarker({ managerComment: 'Отмена, СМЕТА.', customerComment: null }, RULE)).toBe(true);
        expect(hasEstimateMarker({ managerComment: null, customerComment: 'идёт бюджетирование' }, RULE)).toBe(true);
        expect(hasEstimateMarker({ managerComment: 'клиент отказался по цене', customerComment: null }, RULE)).toBe(false);
    });

    it('вердикт засчитывается только при уверенности не ниже порога', () => {
        expect(isVerdictConfirmed({ is_estimate: true, confidence: 0.7 }, RULE)).toBe(true);
        expect(isVerdictConfirmed({ is_estimate: true, confidence: 0.69 }, RULE)).toBe(false);
        expect(isVerdictConfirmed({ is_estimate: false, confidence: 0.99 }, RULE)).toBe(false);
        expect(isVerdictConfirmed(null, RULE)).toBe(false);
    });
});

describe('правило «Смета»', () => {
    it('вне статусов правила не срабатывает даже с причиной «Смета»', () => {
        // Требование: сметы ловим только в «Согласовании отмены», в «Отложено» не лезем.
        const v = evaluateEstimate(order({ status: 'otlozeno', cancelReason: 'calc_rate' }), null, RULE);
        expect(v.isEstimate).toBe(false);
        expect(v.excluded).toBe(false);
    });

    it('причина отмены «Смета» исключает без вердикта ИИ', () => {
        const v = evaluateEstimate(order({ cancelReason: 'calc_rate' }), null, RULE);
        expect(v.excluded).toBe(true);
        expect(v.reason).toContain('исключён');
    });

    it('заказ без сигналов правилом не затрагивается', () => {
        const v = evaluateEstimate(order({ managerComment: 'недозвон, перезвонить завтра' }), null, RULE);
        expect(v.isEstimate).toBe(false);
        expect(v.excluded).toBe(false);
        expect(v.reason).toBeNull();
    });

    it('один текстовый маркер без вердикта оставляет заказ в конверсии', () => {
        const v = evaluateEstimate(order({ managerComment: 'запрос сметы был' }), null, RULE);
        expect(v.isEstimate).toBe(true);
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('диалог не проверен');
    });

    it('вердикт «нет данных» не исключает', () => {
        const v = evaluateEstimate(
            order({ managerComment: 'отмена, смета' }),
            { is_estimate: null, confidence: null },
            RULE,
        );
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('нет данных о сроке закупки');
    });

    it('вердикт ниже порога не исключает', () => {
        const v = evaluateEstimate(
            order({ managerComment: 'отмена, смета' }),
            { is_estimate: true, confidence: 0.5 },
            RULE,
        );
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('не подтверждена уверенно');
    });

    it('вердикт «закупка в обозримый срок» не исключает', () => {
        const v = evaluateEstimate(
            order({ managerComment: 'смета для тендера' }),
            { is_estimate: false, confidence: 0.9 },
            RULE,
        );
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('в обозримый срок');
    });

    it('маркер + уверенный вердикт исключают заказ', () => {
        // Реальный кейс 53818: «закупка в 2027 году, закладывают смету, отмена».
        const v = evaluateEstimate(
            order({ managerComment: '** закупка в 2027 году, закладывают смету, отмена.' }),
            { is_estimate: true, confidence: 0.92 },
            RULE,
        );
        expect(v.excluded).toBe(true);
        expect(v.reason).toContain('исключён');
    });
});
