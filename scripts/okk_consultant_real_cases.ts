import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import postgres from 'postgres';

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

type RealCasesMode = 'write' | 'check';

type CandidateCase = {
    orderId: number;
    order: ConsultantOrder;
    evidence?: OrderEvidence;
    failedCriterionKey: string | null;
    hasMissing: boolean;
    hasAmbiguous: boolean;
    hasHistory: boolean;
    hasCalls: boolean;
};

const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/okk_consultant_real_cases.fixture.json');
const MAX_ORDERS_TO_SCAN = 40;
const REQUIRED_CASES_COUNT = 6;
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const mode: RealCasesMode = process.argv.includes('--check') ? 'check' : 'write';

if (!connectionString) {
    throw new Error('Для генерации real-case fixtures нужен POSTGRES_URL или DATABASE_URL в .env.local.');
}

const sql = postgres(connectionString, {
    ssl: 'require',
    max: 6,
});

function ensureDatabaseEnv() {
    if (!connectionString) {
        throw new Error('Для генерации real-case fixtures нужен POSTGRES_URL или DATABASE_URL в .env.local.');
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
        .replace(new RegExp(`#${sourceOrderId}\\b`, 'g'), `#${caseLabel}`)
        .replace(new RegExp(`заказа?\\s+${sourceOrderId}\\b`, 'gi'), (match) => match.replace(String(sourceOrderId), caseLabel))
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'a***@example.com')
        .replace(/\+?\d[\d\s()\-]{7,}\d/g, '79***22');
}

async function loadCandidateRows() {
    return sql<any[]>`
        WITH recent_scores AS (
            SELECT *
            FROM public.okk_order_scores
            WHERE total_score IS NOT NULL
            ORDER BY updated_at DESC NULLS LAST
            LIMIT ${MAX_ORDERS_TO_SCAN}
        )
        SELECT
            s.*,
            o.status AS order_status,
            m.first_name AS manager_first_name,
            m.last_name AS manager_last_name,
            st.name AS status_name,
            EXISTS(
                SELECT 1 FROM public.call_order_matches com WHERE com.retailcrm_order_id = s.order_id
            ) AS has_calls,
            EXISTS(
                SELECT 1 FROM public.order_history_log oh WHERE oh.retailcrm_order_id = s.order_id
            ) AS has_history
        FROM recent_scores s
        LEFT JOIN public.orders o ON o.order_id = s.order_id
        LEFT JOIN public.managers m ON m.id = COALESCE(o.manager_id, s.manager_id)
        LEFT JOIN public.statuses st ON st.code = o.status
        ORDER BY s.updated_at DESC NULLS LAST
    `;
}

async function loadEvidenceByOrderId(orderId: number, historyLimit: number = 10): Promise<OrderEvidence> {
    const [commentRows, emailRows, callStatsRows, callRows, historyRows, orderRows] = await Promise.all([
        sql<{ count: string }[]>`
            SELECT COUNT(*)::text AS count
            FROM public.raw_order_events
            WHERE retailcrm_order_id = ${orderId}
              AND event_type ILIKE '%comment%'
        `,
        sql<{ count: string }[]>`
            SELECT COUNT(*)::text AS count
            FROM public.raw_order_events
            WHERE retailcrm_order_id = ${orderId}
              AND event_type ILIKE '%email%'
        `,
        sql<{ total_calls: string; transcript_calls: string }[]>`
            SELECT
                COUNT(*)::text AS total_calls,
                COUNT(*) FILTER (WHERE c.transcript IS NOT NULL AND c.transcript <> '')::text AS transcript_calls
            FROM public.call_order_matches m
            JOIN public.raw_telphin_calls c ON c.telphin_call_id = m.telphin_call_id
            WHERE m.retailcrm_order_id = ${orderId}
        `,
        sql<any[]>`
            SELECT
                c.started_at,
                c.direction,
                c.duration_sec,
                LEFT(c.transcript, 220) AS transcript_excerpt,
                c.recording_url
            FROM public.call_order_matches m
            JOIN public.raw_telphin_calls c ON c.telphin_call_id = m.telphin_call_id
            WHERE m.retailcrm_order_id = ${orderId}
            ORDER BY c.started_at DESC NULLS LAST
            LIMIT 20
        `,
        sql<any[]>`
            SELECT field, occurred_at, old_value, new_value
            FROM public.order_history_log
            WHERE retailcrm_order_id = ${orderId}
            ORDER BY occurred_at DESC NULLS LAST
            LIMIT ${historyLimit}
        `,
        sql<any[]>`
            SELECT raw_payload
            FROM public.orders
            WHERE order_id = ${orderId}
            LIMIT 1
        `,
    ]);

    const rawPayload = orderRows[0]?.raw_payload || {};
    const tzFields = ['tz', 'technical_specification', 'width', 'height', 'depth', 'temperature'];
    const calls = callRows || [];
    const callStats = callStatsRows[0] || { total_calls: '0', transcript_calls: '0' };

    return {
        commentCount: Number(commentRows[0]?.count || 0),
        emailCount: Number(emailRows[0]?.count || 0),
        totalCalls: Number(callStats.total_calls || 0),
        transcriptCalls: Number(callStats.transcript_calls || 0),
        calls: calls.map((call) => ({
            started_at: call.started_at || null,
            direction: call.direction || null,
            duration_sec: call.duration_sec || 0,
            hasTranscript: Boolean(call.transcript_excerpt),
            transcript_excerpt: call.transcript_excerpt ? String(call.transcript_excerpt) : null,
            included_in_score: null,
            classification: null,
            classification_reason: null,
            matched_by: null,
        })),
        facts: {
            buyer: rawPayload?.customer?.firstName || rawPayload?.customer?.name || rawPayload?.contact?.name || null,
            company: rawPayload?.company?.name || null,
            phone: rawPayload?.phone || rawPayload?.contact?.phones?.[0]?.number || null,
            email: rawPayload?.email || null,
            totalSum: rawPayload?.totalSumm || null,
            category: rawPayload?.customFields?.tovarnaya_kategoriya || rawPayload?.customFields?.product_category || rawPayload?.category || null,
            sphere: rawPayload?.customFields?.sfera_deiatelnosti || rawPayload?.customFields?.sphere_of_activity || null,
            purchaseForm: rawPayload?.customFields?.typ_customer_margin || rawPayload?.customFields?.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete || null,
            expectedAmount: rawPayload?.customFields?.expected_amount || rawPayload?.customFields?.ozhidaemaya_summa || null,
            nextContactDate: rawPayload?.customFields?.next_contact_date || rawPayload?.customFields?.data_kontakta || null,
            status: rawPayload?.status || null,
        },
        tzEvidence: {
            customerComment: rawPayload?.customerComment || null,
            managerComment: rawPayload?.managerComment || null,
            customFieldKeys: tzFields.filter((field) => Boolean(rawPayload?.customFields?.[field])),
        },
        lastHistoryEvents: (historyRows || []).map((item) => ({
            field: item.field || null,
            created_at: item.occurred_at || null,
            old_value: item.old_value ?? null,
            new_value: item.new_value ?? null,
        })),
    };
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

function serializeFixtures(fixtures: RealCaseFixture[]) {
    return `${JSON.stringify(fixtures, null, 2)}\n`;
}

function buildFixtureFingerprint(fixtures: RealCaseFixture[]) {
    return fixtures
        .map((fixture) => `${fixture.id}:${fixture.metadata.caseLabel}:${fixture.metadata.statusLabel || '—'}:${fixture.answer.length}`)
        .join('\n');
}

async function verifyFixtureFile(fixtures: RealCaseFixture[]) {
    const nextSerialized = serializeFixtures(fixtures);

    try {
        const currentSerialized = await fs.readFile(OUTPUT_PATH, 'utf8');
        if (currentSerialized !== nextSerialized) {
            const currentFixtures = JSON.parse(currentSerialized) as RealCaseFixture[];
            console.error('[real-cases] fixture drift detected.');
            console.error('[real-cases] current fingerprint:');
            console.error(buildFixtureFingerprint(currentFixtures));
            console.error('[real-cases] regenerated fingerprint:');
            console.error(buildFixtureFingerprint(fixtures));
            process.exitCode = 1;
            return;
        }

        console.log(`[real-cases] fixture check passed: ${OUTPUT_PATH}`);
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            console.error(`[real-cases] fixture file is missing: ${OUTPUT_PATH}`);
            process.exitCode = 1;
            return;
        }
        throw error;
    }
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

function hasEnoughCoverage(candidates: CandidateCase[]) {
    if (candidates.length < REQUIRED_CASES_COUNT) return false;

    return candidates.some((candidate) => Boolean(candidate.failedCriterionKey))
        && candidates.some((candidate) => candidate.hasMissing)
        && candidates.some((candidate) => candidate.hasAmbiguous)
        && candidates.some((candidate) => candidate.hasHistory)
        && candidates.some((candidate) => candidate.hasCalls);
}

async function main() {
    ensureDatabaseEnv();

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

    const candidates = await (async (): Promise<CandidateCase[]> => {
        const data = await loadCandidateRows();

        const rows: CandidateCase[] = [];
        for (const [index, item] of (data || []).entries()) {
            const order = sanitizeOrderForRole({
                ...item,
                order_id: Number(item.order_id),
                manager_name: [item.manager_first_name, item.manager_last_name].filter(Boolean).join(' ') || item.manager_name || '—',
                status_label: item.status_name || item.status_label || item.order_status || '—',
            }, 'manager');

            const candidate: CandidateCase = {
                orderId: Number(item.order_id),
                order,
                failedCriterionKey: pickFailedCriterionKey(order),
                hasMissing: hasMissingData(order),
                hasAmbiguous: hasAmbiguousCriteria(order),
                hasHistory: Boolean(item.has_history),
                hasCalls: Boolean(item.has_calls),
            };

            rows.push(candidate);

            console.log(
                `[real-cases] scanned ${index + 1}/${data.length}: order #${item.order_id} `
                + `(failed=${Boolean(candidate.failedCriterionKey)}, missing=${candidate.hasMissing}, ambiguous=${candidate.hasAmbiguous}, history=${candidate.hasHistory}, calls=${candidate.hasCalls})`
            );

            if (hasEnoughCoverage(rows)) {
                console.log(`[real-cases] enough coverage collected after ${index + 1} orders`);
                break;
            }
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

    const selectedCases = [scoreCase, failedCase, missingCase, ambiguousCase, callsCase, historyCase];
    const hydratedEvidence = new Map<number, OrderEvidence>();

    console.log(`[real-cases] selected ${selectedCases.length} fixture slots from ${new Set(selectedCases.map((candidate) => candidate.orderId)).size} unique orders`);

    for (const candidate of selectedCases) {
        if (!hydratedEvidence.has(candidate.orderId)) {
            const hydrationStartedAt = Date.now();
            const rawEvidence = await loadEvidenceByOrderId(candidate.orderId, 10);
            console.log(`[real-cases] loaded raw evidence for order #${candidate.orderId} in ${Date.now() - hydrationStartedAt}ms`);
            const enrichedEvidence = enrichEvidenceWithOrder(candidate.order, rawEvidence);
            console.log(`[real-cases] enriched evidence for order #${candidate.orderId} in ${Date.now() - hydrationStartedAt}ms`);
            const evidence = sanitizeEvidenceForRole(enrichedEvidence, 'manager');
            hydratedEvidence.set(candidate.orderId, evidence);
            console.log(`[real-cases] hydrated evidence for order #${candidate.orderId} in ${Date.now() - hydrationStartedAt}ms`);
        }
        candidate.evidence = hydratedEvidence.get(candidate.orderId);
    }

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

    if (mode === 'check') {
        await verifyFixtureFile(fixtures);
        return;
    }

    await fs.writeFile(OUTPUT_PATH, serializeFixtures(fixtures), 'utf8');

    console.log(`Подготовлено ${fixtures.length} анонимизированных эталонных кейсов: ${OUTPUT_PATH}`);
}

main()
    .catch((error) => {
        console.error('Не удалось подготовить real-case fixtures:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await sql.end();
    });