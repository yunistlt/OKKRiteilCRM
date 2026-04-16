import assert from 'node:assert/strict';
import {
    buildAmbiguousCriteriaSummary,
    buildCallEvidenceExplanation,
    buildConsultantMetaAnswer,
    buildCriterionExplanation,
    buildSectionAnswer,
    getReplyCriterionKey,
    buildGeneralRatingExplanation,
    buildGlossaryAnswer,
    buildHistoryEvidenceExplanation,
    buildMissingDataSummary,
    buildOrderSourceExplanation,
    shouldShowOrderCards,
    buildViolationsReferenceAnswer,
    enrichEvidenceWithOrder,
    findGlossaryTerm,
    isGlossaryQuestion,
    type ConsultantOrder,
    type OrderEvidence,
} from '../lib/okk-consultant';
import { OKK_CONSULTANT_BENCHMARK_CASES } from './okk_consultant_benchmark_cases';

const sampleOrder: ConsultantOrder = {
    order_id: 777001,
    manager_name: 'Тест Менеджер',
    status_label: 'В работе',
    deal_score: 8,
    deal_score_pct: 62,
    script_score: 9,
    script_score_pct: 64,
    total_score: 58,
    time_to_first_contact: '2ч 15м',
    score_breakdown: {
        relevant_number_found: {
            result: false,
            reason: 'Исходящих звонков по заказу не найдено.',
            source_values: {
                calls_attempts_count: 0,
                calls_status: 'not_found',
                calls: [],
            },
            calculation_steps: ['Смотрим связанные исходящие звонки по заказу.'],
            confidence: 0.58,
            missing_data: ['calls:matched_outgoing'],
            recommended_fix: 'Нужно совершить и корректно зафиксировать попытку дозвона.',
            ambiguous_explanation: true,
        },
        script_greeting: {
            result: true,
            reason: 'В транскрипте есть приветствие и идентификация менеджера.',
            source_values: {
                transcript_length: 420,
                anna_insights_available: true,
            },
            calculation_steps: ['AI анализирует историю транскрипций по сделке.'],
            confidence: 0.72,
            missing_data: [],
            context_fragment: 'Добрый день, компания ОКК, меня зовут Анна.',
            model: 'gpt-4o-mini',
            ambiguous_explanation: false,
        },
        _meta: {
            result: null,
            reason: 'Служебная сводка explainability для итогового расчёта.',
            source_values: {
                deal_score_pct: 62,
                script_score_pct: 64,
                total_score_before_penalty: 63,
                total_score_after_penalty: 58,
                total_penalty: 5,
            },
            calculation_steps: [
                'deal_score_pct = round(8/13 * 100) => 62',
                'script_score = round(script_score_pct / 100 * 14) => 9',
                'После штрафов итог уменьшен на 5 п. => 58',
            ],
            confidence: 1,
            missing_data: [],
            ambiguous_explanation: false,
            penalty_journal: [
                {
                    rule_code: 'order_dragging',
                    severity: 'high',
                    points: 5,
                    details: 'Сделка зависла без движения по статусу.',
                    detected_at: '2026-04-14T10:00:00.000Z',
                },
            ],
        },
    },
};

const baseEvidence: OrderEvidence = {
    commentCount: 0,
    emailCount: 1,
    totalCalls: 0,
    transcriptCalls: 0,
    calls: [],
    facts: {
        buyer: 'ООО Клиент',
        company: 'ООО Клиент',
        phone: '+79990001122',
        email: 'client@example.com',
        totalSum: 125000,
        category: 'Камеры',
        expectedAmount: 125000,
        nextContactDate: '2026-04-15T10:00:00.000Z',
        status: 'in_progress',
    },
    tzEvidence: {
        customerComment: 'Нужна камера 2000x3000 с температурой -18.',
        managerComment: 'Уточнить толщину панелей и тип двери.',
        customFieldKeys: ['width', 'height', 'temperature'],
    },
    lastHistoryEvents: [],
};

function assertContains(output: string, fragments: string[], context: string) {
    for (const fragment of fragments) {
        assert.ok(output.includes(fragment), `${context}: expected fragment not found: ${fragment}`);
    }
}

function assertNotContains(output: string, fragments: string[] | undefined, context: string) {
    for (const fragment of fragments || []) {
        assert.ok(!output.includes(fragment), `${context}: forbidden fragment found: ${fragment}`);
    }
}

function run() {
    const enrichedEvidence = enrichEvidenceWithOrder(sampleOrder, baseEvidence);
    const oldFormatOrder: ConsultantOrder = {
        order_id: 777002,
        score_breakdown: {
            field_contact_data: {
                result: false,
                reason: 'Не найден телефон или email.',
            },
        },
    };

    const outputs: Record<string, string> = {
        'general-rating-formula': buildGeneralRatingExplanation(),
        'glossary-total-score': buildGlossaryAnswer(findGlossaryTerm('что такое total_score')!),
        'glossary-sla-definition': isGlossaryQuestion('что такое SLA ?') ? buildGlossaryAnswer(findGlossaryTerm('что такое SLA ?')!) : '',
        'missing-data-explicit-limitation': buildMissingDataSummary(sampleOrder),
        'ambiguous-confidence': buildAmbiguousCriteriaSummary(sampleOrder),
        'proof-no-history': buildHistoryEvidenceExplanation(sampleOrder, enrichedEvidence),
        'proof-no-calls': buildCallEvidenceExplanation(sampleOrder, enrichedEvidence),
        'criterion-source-explicit-fact': buildCriterionExplanation({ order: sampleOrder, criterionKey: 'relevant_number_found', mode: 'source', evidence: enrichedEvidence }),
        'violations-button-reference': buildViolationsReferenceAnswer(sampleOrder),
        'section-ai-tools-overview': buildSectionAnswer('ai-tools', 'как работает этот раздел') || '',
        'section-quality-overview': buildSectionAnswer('quality-dashboard', 'для чего этот экран') || '',
        'section-audit-overview': buildSectionAnswer('audit', 'что это за раздел') || '',
        'meta-ui-visibility': buildConsultantMetaAnswer('Справка по ОКК'),
        'order-source-overview': buildOrderSourceExplanation(sampleOrder, enrichedEvidence),
        'historical-old-format-safe': buildCriterionExplanation({ order: oldFormatOrder, criterionKey: 'field_contact_data', mode: 'why' }),
        'paraphrase-same-criterion-a': buildCriterionExplanation({ order: sampleOrder, criterionKey: 'relevant_number_found', mode: 'why', evidence: enrichedEvidence }),
        'paraphrase-same-criterion-b': buildCriterionExplanation({ order: sampleOrder, criterionKey: 'relevant_number_found', mode: 'why', evidence: enrichedEvidence }),
    };

    for (const testCase of OKK_CONSULTANT_BENCHMARK_CASES) {
        const output = outputs[testCase.id];
        assert.ok(output, `Missing output for benchmark case: ${testCase.id}`);
        assertContains(output, testCase.expectedFragments, testCase.id);
        assertNotContains(output, testCase.forbiddenFragments, testCase.id);
    }

    const sourceA = outputs['paraphrase-same-criterion-a'];
    const sourceB = outputs['paraphrase-same-criterion-b'];
    assert.equal(sourceA, sourceB, 'Criterion explanation should stay stable across paraphrases when criterionKey is the same.');

    assert.equal(shouldShowOrderCards('glossary'), false, 'Glossary replies should not attach order cards.');
    assert.equal(shouldShowOrderCards('section'), false, 'Section replies should not attach order cards.');
    assert.equal(shouldShowOrderCards('meta'), false, 'Meta replies should not attach order cards.');
    assert.equal(getReplyCriterionKey('glossary', 'lead_in_work_lt_1_day'), null, 'Glossary replies should not persist a criterion key.');
    assert.equal(getReplyCriterionKey('section', 'lead_in_work_lt_1_day'), null, 'Section replies should not persist a criterion key.');
    assert.equal(getReplyCriterionKey('criterion', 'lead_in_work_lt_1_day'), 'lead_in_work_lt_1_day', 'Criterion replies should keep the matched criterion key.');

    console.log(`OKK consultant regression passed: ${OKK_CONSULTANT_BENCHMARK_CASES.length} cases.`);
}

run();