import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

import type { ConsultantOrder, OrderEvidence } from '../lib/okk-consultant';

type RealCaseFixture = {
    id: string;
    source: 'real-order-anonymized';
    question: string;
    answer: string;
    metadata: {
        caseLabel: string;
        criterionKey?: string;
        statusLabel?: string;
        totalScore?: number | null;
        dealScorePct?: number | null;
        scriptScorePct?: number | null;
    };
};

type CandidateCase = {
    order: ConsultantOrder;
    evidence: OrderEvidence;
    failedCriterionKey: string | null;
    hasMissing: boolean;
    hasAmbiguous: boolean;
    hasHistory: boolean;
    hasCalls: boolean;
};

const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/okk_consultant_real_cases.fixture.json');
const MAX_ORDERS_TO_SCAN = 40;

function ensureSupabaseEnv() {
    const hasSupabaseKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !hasSupabaseKey) {
        throw new Error('Для генерации real-case fixtures нужны NEXT_PUBLIC_SUPABASE_URL и один из ключей: SUPABASE_SERVICE_ROLE_KEY или NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local.');
    }
}

function getVisibleEntries(order: ConsultantOrder) {
    return Object.entries(order.score_breakdown || {}).filter(([key]) => !key.startsWith('_'));
}

function pickFailedCriterionKey(order: ConsultantOrder): string | null {
    const failed = getVisibleEntries(order).find(([, entry]) => entry?.result === false);
    return failed?.[0] || null;
}

function hasMissingData(order: ConsultantOrder): boolean {
    return getVisibleEntries(order).some(([, entry]) => Array.isArray(entry?.missing_data) && entry.missing_data.length > 0);
}

function hasAmbiguousCriteria(order: ConsultantOrder): boolean {
    return getVisibleEntries(order).some(([, entry]) => Boolean(entry?.ambiguous_explanation) || (typeof entry?.confidence === 'number' && entry.confidence < 0.6));
}

function anonymizeText(text: string, sourceOrderId: number, caseLabel: string): string {
    return text
        .replace(new RegExp(`#${sourceOrderId}\b`, 'g'), `#${caseLabel}`)
        .replace(new RegExp(`заказа?\s+${sourceOrderId}\b`, 'gi'), (match) => match.replace(String(sourceOrderId), caseLabel))
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'a***@example.com')
        .replace(/\+?\d[\d\s()\-]{7,}\d/g, '79***22');
}

function buildFixture(id: string, question: string, answer: string, order: ConsultantOrder, caseLabel: string, criterionKey?: string | null): RealCaseFixture {
    return {
        id,
        source: 'real-order-anonymized',
        question,
        answer: anonymizeText(answer, order.order_id, caseLabel),
        metadata: {
            caseLabel,
            criterionKey: criterionKey || undefined,
            statusLabel: order.status_label,
            totalScore: order.total_score ?? null,
            dealScorePct: order.deal_score_pct ?? null,
            scriptScorePct: order.script_score_pct ?? null,
        },
    };
}

function pickCandidate(candidates: CandidateCase[], predicate: (candidate: CandidateCase) => boolean, used: Set<number>): CandidateCase {
    const chosen = candidates.find((candidate) => !used.has(candidate.order.order_id) && predicate(candidate))
        || candidates.find((candidate) => !used.has(candidate.order.order_id))
        || candidates[0];

    if (!chosen) {
        throw new Error('Не удалось подобрать реальные кейсы ОКК для golden dataset.');
    }

    used.add(chosen.order.order_id);
    return chosen;
}

async function main() {
    ensureSupabaseEnv();

    const {
        buildAmbiguousCriteriaSummary,
        buildCallEvidenceExplanation,
        buildCriterionExplanation,
        buildHistoryEvidenceExplanation,
        buildMissingDataSummary,
        buildOrderScoreExplanation,
        enrichEvidenceWithOrder,
        sanitizeEvidenceForRole,
        sanitizeOrderForRole,
    } = await import('../lib/okk-consultant');
    const { loadConsultantEvidence, loadConsultantOrder } = await import('../lib/okk-consultant-context');
    const { supabase } = await import('../utils/supabase');

    const candidates = await (async (): Promise<CandidateCase[]> => {
        const { data, error } = await supabase
            .from('okk_order_scores')
            .select('order_id, updated_at')
            .not('total_score', 'is', null)
            .order('updated_at', { ascending: false })
            .limit(MAX_ORDERS_TO_SCAN);

        if (error) throw error;

        const rows: CandidateCase[] = [];

        for (const item of data || []) {
            const order = sanitizeOrderForRole(await loadConsultantOrder(item.order_id, 'manager', null), 'manager');
            const evidence = sanitizeEvidenceForRole(enrichEvidenceWithOrder(order, await loadConsultantEvidence(item.order_id, 10)), 'manager');

            rows.push({
                order,
                evidence,
                failedCriterionKey: pickFailedCriterionKey(order),
                hasMissing: hasMissingData(order),
                hasAmbiguous: hasAmbiguousCriteria(order),
                hasHistory: evidence.lastHistoryEvents.length > 0,
                hasCalls: evidence.totalCalls > 0,
            });
        }

        return rows;
    })();

    if (candidates.length === 0) {
        throw new Error('В okk_order_scores нет данных для подготовки real-case fixtures.');
    }

    const used = new Set<number>();
    const scoreCase = pickCandidate(candidates, () => true, used);
    const failedCase = pickCandidate(candidates, (candidate) => Boolean(candidate.failedCriterionKey), used);
    const missingCase = pickCandidate(candidates, (candidate) => candidate.hasMissing, used);
    const ambiguousCase = pickCandidate(candidates, (candidate) => candidate.hasAmbiguous, used);
    const callsCase = pickCandidate(candidates, (candidate) => candidate.hasCalls, used);
    const historyCase = pickCandidate(candidates, (candidate) => candidate.hasHistory, used);

    const scoreLabel = 'CASE-001';
    const failedLabel = 'CASE-002';
    const missingLabel = 'CASE-003';
    const ambiguousLabel = 'CASE-004';
    const callsLabel = 'CASE-005';
    const historyLabel = 'CASE-006';

    const fixtures: RealCaseFixture[] = [
        buildFixture(
            'real-score-explanation',
            'Как по этому заказу посчитан итоговый рейтинг ОКК?',
            buildOrderScoreExplanation(scoreCase.order),
            scoreCase.order,
            scoreLabel,
        ),
        buildFixture(
            'real-failed-criterion',
            'Почему по этому заказу стоит крестик по критерию?',
            buildCriterionExplanation({
                order: failedCase.order,
                criterionKey: failedCase.failedCriterionKey || 'field_contact_data',
                mode: 'why',
                evidence: failedCase.evidence,
            }),
            failedCase.order,
            failedLabel,
            failedCase.failedCriterionKey,
        ),
        buildFixture(
            'real-missing-data',
            'Каких данных по этому заказу не хватает для уверенного объяснения?',
            buildMissingDataSummary(missingCase.order),
            missingCase.order,
            missingLabel,
        ),
        buildFixture(
            'real-ambiguous-criteria',
            'Какие критерии по этому заказу спорные и требуют ручной проверки?',
            buildAmbiguousCriteriaSummary(ambiguousCase.order),
            ambiguousCase.order,
            ambiguousLabel,
        ),
        buildFixture(
            'real-call-proof',
            'Какие звонки реально повлияли на оценку по этому заказу?',
            buildCallEvidenceExplanation(callsCase.order, callsCase.evidence),
            callsCase.order,
            callsLabel,
        ),
        buildFixture(
            'real-history-proof',
            'Какие события истории заказа подтверждают вывод системы?',
            buildHistoryEvidenceExplanation(historyCase.order, historyCase.evidence),
            historyCase.order,
            historyLabel,
        ),
    ];

    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');

    console.log(`Подготовлено ${fixtures.length} анонимизированных эталонных кейсов: ${OUTPUT_PATH}`);
}

main().catch((error) => {
    console.error('Не удалось подготовить real-case fixtures:', error);
    process.exitCode = 1;
});