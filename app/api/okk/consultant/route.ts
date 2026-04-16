import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
    buildAmbiguousCriteriaSummary,
    buildCallEvidenceExplanation,
    buildCriterionExplanation,
    buildEvidenceSummary,
    buildFailedCriteriaSummary,
    buildGeneralRatingExplanation,
    buildGlossaryAnswer,
    buildHistoryEvidenceExplanation,
    buildImprovementPlan,
    buildMissingDataSummary,
    buildOrderContextForLLM,
    buildOrderScoreExplanation,
    buildResponseCards,
    buildSectionAnswer,
    buildTechnicalExplanation,
    buildViolationsReferenceAnswer,
    ConsultantOrder,
    enrichEvidenceWithOrder,
    findCriterionKey,
    findGlossaryTerm,
    getConsultantSectionConfig,
    OKK_CONSULTANT_QUICK_QUESTIONS,
    OrderEvidence,
    sanitizeEvidenceForRole,
    sanitizeOrderForRole,
} from '@/lib/okk-consultant';
import { loadConsultantEvidence, loadConsultantOrder } from '@/lib/okk-consultant-context';
import { isMissingConsultantPersistenceError } from '@/lib/okk-consultant-persistence';
import { getOpenAIClient } from '@/utils/openai';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 10;
const MAX_HISTORY_TEXT_LENGTH = 600;
const REFERENCE_CACHE_TTL_MS = 1000 * 60 * 60;
const THREAD_TTL_DAYS = 30;

const referenceAnswerCache = new Map<string, { reply: string; cachedAt: number }>();

async function archiveExpiredThreads(userId: string) {
    const expiresAt = new Date(Date.now() - THREAD_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
        .from('okk_consultant_threads')
        .update({ archived_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('archived_at', null)
        .lt('updated_at', expiresAt);

    if (error) throw error;
}

async function getOrCreateThread(userId: string, username: string, orderId: number | null, threadId: string | null | undefined, sectionKey: string) {
    await archiveExpiredThreads(userId);

    const resolvedSectionKey = getConsultantSectionConfig(sectionKey || null).key;
    const scopePrefix = `scope:${resolvedSectionKey}:${orderId ?? 'global'}:`;

    if (threadId) {
        const { data: threadById, error: threadError } = await supabase
            .from('okk_consultant_threads')
            .select('*')
            .eq('id', threadId)
            .eq('user_id', userId)
            .maybeSingle();

        if (threadError) throw threadError;
        if (threadById) return threadById;
    }

    let query = supabase
        .from('okk_consultant_threads')
        .select('*')
        .eq('user_id', userId)
        .is('archived_at', null)
        .like('branch_key', `${scopePrefix}%`)
        .order('updated_at', { ascending: false })
        .limit(1);

    query = orderId === null ? query.is('order_id', null) : query.eq('order_id', orderId);

    const { data: existing, error: existingError } = await query.maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing;

    const { data: created, error: createError } = await supabase
        .from('okk_consultant_threads')
        .insert({
            user_id: userId,
            username,
            order_id: orderId,
            branch_key: `${scopePrefix}main`,
            title: orderId ? `${getConsultantSectionConfig(resolvedSectionKey).shortTitle}: заказ #${orderId}` : `Общий контекст: ${getConsultantSectionConfig(resolvedSectionKey).title}`,
        })
        .select('*')
        .single();

    if (createError) throw createError;
    return created;
}

async function persistConversation(params: {
    threadId: string;
    userId: string;
    username: string;
    orderId: number | null;
    question: string;
    answer: string;
    intent: string;
    criterionKey: string | null;
    usedFallback: boolean;
    answerMetadata?: Record<string, any> | null;
}) {
    const traceId = crypto.randomUUID();
    const { threadId, userId, username, orderId, question, answer, intent, criterionKey, usedFallback, answerMetadata } = params;

    const [{ error: insertUserError }, { error: insertAgentError }, { error: logError }, { error: threadUpdateError }] = await Promise.all([
        supabase.from('okk_consultant_messages').insert({
            thread_id: threadId,
            role: 'user',
            content: question,
            metadata: { traceId },
        }),
        supabase.from('okk_consultant_messages').insert({
            thread_id: threadId,
            role: 'agent',
            content: answer,
            metadata: { traceId, criterion_key: criterionKey, intent, ...(answerMetadata || {}) },
        }),
        supabase.from('okk_consultant_logs').insert({
            trace_id: traceId,
            thread_id: threadId,
            user_id: userId,
            username,
            order_id: orderId,
            criterion_key: criterionKey,
            intent,
            question,
            answer_preview: answer.slice(0, 500),
            used_fallback: usedFallback,
        }),
        supabase.from('okk_consultant_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId),
    ]);

    if (insertUserError) throw insertUserError;
    if (insertAgentError) throw insertAgentError;
    if (logError) throw logError;
    if (threadUpdateError) throw threadUpdateError;

    return traceId;
}

function needsOrderContext(message: string, criterionKey: string | null): boolean {
    const lower = message.toLowerCase();

    if (isViolationsReferenceQuestion(lower)) {
        return false;
    }

    return Boolean(
        criterionKey ||
        lower.includes('почему') ||
        lower.includes('крест') ||
        lower.includes('галоч') ||
        lower.includes('балл') ||
        lower.includes('рейтинг') ||
        lower.includes('процент') ||
        lower.includes('откуда') ||
        lower.includes('исправ') ||
        lower.includes('заказ')
    );
}

function normalizeSectionKey(rawSectionKey: unknown) {
    return getConsultantSectionConfig(typeof rawSectionKey === 'string' ? rawSectionKey : null).key;
}

function isReferenceQuestion(lower: string): boolean {
    return lower.includes('что такое')
        || lower.includes('что значит')
        || lower.includes('что означает')
        || lower.includes('зачем')
        || lower.includes('для чего')
        || lower.includes('как работает')
        || lower.includes('что показывает');
}

function isViolationsReferenceQuestion(message: string): boolean {
    const lower = message.toLowerCase();
    const asksForMeaning = isReferenceQuestion(lower);
    const mentionsUi = lower.includes('кноп') || lower.includes('колон') || lower.includes('столб') || lower.includes('индикатор');
    const mentionsViolations = lower.includes('наруш') || lower.includes('штраф');

    return mentionsViolations && (asksForMeaning || mentionsUi);
}

function detectMode(message: string): 'why' | 'source' | 'fix' | 'score' | 'failures' | 'proof' | 'technical' | 'general' | 'ambiguous' | 'missing' {
    const lower = message.toLowerCase();
    if (isViolationsReferenceQuestion(lower)) return 'general';
    if (lower.includes('доказ') || lower.includes('покажи данные') || lower.includes('покажи доказательства')) return 'proof';
    if (lower.includes('какие звонки') || lower.includes('какой звонок') || lower.includes('какие события') || lower.includes('история заказа') || lower.includes('реальный разговор') || lower.includes('автоответ')) return 'proof';
    if (lower.includes('спорн') || lower.includes('ручн') || lower.includes('сомнител')) return 'ambiguous';
    if (lower.includes('каких данных не хватает') || lower.includes('не хватает данных') || lower.includes('данных отсутств') || lower.includes('не может дать уверенное объяснение')) return 'missing';
    if (lower.includes('технический разбор') || lower.includes('technical') || lower.includes('debug')) return 'technical';
    if (lower.includes('откуда') || lower.includes('какие данные') || lower.includes('источник')) return 'source';
    if (lower.includes('исправ') || lower.includes('что сделать') || lower.includes('как улучш')) return 'fix';
    if (lower.includes('балл') || lower.includes('рейтинг') || lower.includes('процент') || lower.includes('посчитан')) return 'score';
    if (lower.includes('крест') || lower.includes('галоч') || lower.includes('почему') || lower.includes('не выполн')) return 'why';
    if (lower.includes('проблем') || lower.includes('провал') || lower.includes('наруш')) return 'failures';
    return 'general';
}

function applyResponseMode(reply: string, responseMode: 'short' | 'full'): string {
    if (responseMode === 'full') return reply;

    const compactLines = reply
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 6);

    return compactLines.join('\n');
}

function getCachedReferenceAnswer(cacheKey: string, build: () => string): string {
    const now = Date.now();
    const cached = referenceAnswerCache.get(cacheKey);

    if (cached && now - cached.cachedAt < REFERENCE_CACHE_TTL_MS) {
        return cached.reply;
    }

    const reply = build();
    referenceAnswerCache.set(cacheKey, { reply, cachedAt: now });
    return reply;
}

async function buildFallbackAnswer(message: string, order: ConsultantOrder | null, evidence: OrderEvidence | null, sectionKey: string): Promise<string | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const openai = getOpenAIClient();
    const section = getConsultantSectionConfig(sectionKey);
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
            {
                role: 'system',
                content: `Ты консультант по ОКК. Текущий раздел: ${section.title}. Отвечай только в домене ОКК. Не выдумывай поля, звонки, формулы и причины. Если данных не хватает, прямо так и скажи. Структура ответа: короткий вывод, данные, расчет или правило, что делать дальше.`
            },
            {
                role: 'user',
                content: [
                    `Вопрос пользователя: ${message}`,
                    `Раздел: ${section.title}. ${section.summary}`,
                    '',
                    'Справка по расчету:',
                    buildGeneralRatingExplanation(),
                    '',
                    order ? `Контекст заказа:\n${buildOrderContextForLLM(order, evidence)}` : 'Контекст заказа не выбран.',
                ].join('\n')
            }
        ],
    });

    return completion.choices[0]?.message?.content || null;
}

function normalizeHistory(history: unknown): Array<{ role: string; text: string }> {
    if (!Array.isArray(history)) return [];

    return history
        .filter((item) => item && typeof item === 'object')
        .map((item: any) => ({
            role: item.role === 'agent' || item.role === 'user' || item.role === 'system' ? item.role : 'user',
            text: String(item.text || '').slice(0, MAX_HISTORY_TEXT_LENGTH).trim(),
        }))
        .filter((item) => item.text)
        .slice(-MAX_HISTORY_ITEMS);
}

function isGlossaryQuestion(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('что такое') || lower.includes('что значит') || lower.includes('объясни термин');
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
        }

        const body = await req.json();
        const message = String(body.message || '').trim();
        const responseMode = body.responseMode === 'short' ? 'short' : 'full';
        const orderIdRaw = body.orderId;
        const history = normalizeHistory(body.history);
        const threadIdRaw = typeof body.threadId === 'string' ? body.threadId : null;
        const sectionKey = normalizeSectionKey(body.sectionKey);
        const selectionContext = body.selectionContext && typeof body.selectionContext === 'object' ? body.selectionContext : null;

        if (!message) {
            return NextResponse.json({ error: 'Сообщение обязательно' }, { status: 400 });
        }

        if (message.length > MAX_MESSAGE_LENGTH) {
            return NextResponse.json({ error: `Сообщение слишком длинное. Лимит: ${MAX_MESSAGE_LENGTH} символов.` }, { status: 400 });
        }

        const orderId = typeof orderIdRaw === 'number'
            ? orderIdRaw
            : typeof orderIdRaw === 'string' && orderIdRaw.trim()
                ? Number(orderIdRaw)
                : null;

        const criterionKey = findCriterionKey(message);
        const glossaryTerm = findGlossaryTerm(message);
        const mode = detectMode(message);
        const userRole = session.user.role || 'admin';
        const retailCrmManagerId = session.user.retail_crm_manager_id ? Number(session.user.retail_crm_manager_id) : null;
        const userId = String(session.user.id);
        const username = String(session.user.username || 'user');
        const violationsReferenceQuestion = isViolationsReferenceQuestion(message);
        const sectionReply = buildSectionAnswer(sectionKey, message, selectionContext);

        if (!orderId && !glossaryTerm && !sectionReply && needsOrderContext(message, criterionKey)) {
            return NextResponse.json({
                success: true,
                reply: 'Для такого вопроса мне нужен выбранный заказ. Выберите сделку в таблице ОКК, и я смогу объяснить балл, причины крестиков, источники данных и действия для исправления.',
                suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
            });
        }

        if (!orderId) {
            if (violationsReferenceQuestion) {
                return NextResponse.json({
                    success: true,
                    reply: buildViolationsReferenceAnswer(null),
                    suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
                });
            }

            if (glossaryTerm && isGlossaryQuestion(message)) {
                return NextResponse.json({
                    success: true,
                    reply: getCachedReferenceAnswer(`glossary:${glossaryTerm.key}`, () => buildGlossaryAnswer(glossaryTerm)),
                    suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
                });
            }

            if (criterionKey) {
                return NextResponse.json({
                    success: true,
                    reply: getCachedReferenceAnswer(`criterion:${criterionKey}:general`, () => buildCriterionExplanation({
                        order: { order_id: 0, score_breakdown: null },
                        criterionKey,
                        mode: 'general',
                    })),
                    suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
                });
            }

            if (sectionReply) {
                return NextResponse.json({
                    success: true,
                    reply: sectionReply,
                    suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
                });
            }

            return NextResponse.json({
                success: true,
                reply: getCachedReferenceAnswer('general:rating', () => buildGeneralRatingExplanation()),
                suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
            });
        }

        const [rawOrder, rawEvidence] = await Promise.all([
            loadConsultantOrder(orderId, userRole, retailCrmManagerId),
            loadConsultantEvidence(orderId),
        ]);
        const order = sanitizeOrderForRole(rawOrder, userRole);
        const evidence = sanitizeEvidenceForRole(enrichEvidenceWithOrder(rawOrder, rawEvidence), userRole);

        let thread: { id: string } | null = null;
        let persistenceDisabled = false;

        try {
            thread = await getOrCreateThread(userId, username, orderId, threadIdRaw, sectionKey);
        } catch (threadError: any) {
            if (isMissingConsultantPersistenceError(threadError)) {
                persistenceDisabled = true;
                console.warn('[OKK Consultant] Persistence schema is missing, continuing in ephemeral mode.');
            } else {
                throw threadError;
            }
        }

        let reply: string;
        let usedFallback = false;
        if (sectionReply) {
            reply = sectionReply;
        } else if (violationsReferenceQuestion) {
            reply = buildViolationsReferenceAnswer(order);
        } else if (!criterionKey && glossaryTerm && isGlossaryQuestion(message)) {
            reply = buildGlossaryAnswer(glossaryTerm);
        } else if (criterionKey) {
            reply = buildCriterionExplanation({
                order,
                criterionKey,
                mode: mode === 'source' ? 'source' : mode === 'fix' ? 'fix' : 'why',
                evidence,
            });
        } else if (mode === 'score') {
            reply = buildOrderScoreExplanation(order);
        } else if (mode === 'proof') {
            reply = /событ|истори/i.test(message)
                ? buildHistoryEvidenceExplanation(order, evidence)
                : /звон|разговор|автоответ|ivr/i.test(message)
                    ? buildCallEvidenceExplanation(order, evidence)
                    : buildEvidenceSummary(order, evidence);
        } else if (mode === 'ambiguous') {
            reply = buildAmbiguousCriteriaSummary(order);
        } else if (mode === 'missing') {
            reply = buildMissingDataSummary(order);
        } else if (mode === 'technical') {
            reply = userRole === 'manager'
                ? `${buildEvidenceSummary(order, evidence)}\n\nТехнические детали скрыты для роли менеджера по умолчанию. Если нужен глубокий разбор, его должен открыть ОКК или администратор.`
                : buildTechnicalExplanation(order, evidence);
        } else if (mode === 'fix') {
            reply = buildImprovementPlan(order);
        } else if (mode === 'failures') {
            reply = buildFailedCriteriaSummary(order);
        } else {
            const fallbackReply = await buildFallbackAnswer(
                [
                    message,
                    history.length > 0
                        ? `\n\nКраткая история диалога:\n${history.map((item) => `${item.role}: ${item.text}`).join('\n')}`
                        : '',
                ].join(''),
                order,
                evidence,
                sectionKey
            );
            reply = fallbackReply || buildOrderScoreExplanation(order);
            usedFallback = Boolean(fallbackReply);
        }

        const cards = buildResponseCards({
            order,
            mode,
            criterionKey,
            evidence,
        });
        const formattedReply = applyResponseMode(reply, responseMode);

        let traceId: string | null = null;
        if (thread) {
            try {
                traceId = await persistConversation({
                    threadId: thread.id,
                    userId,
                    username,
                    orderId,
                    question: message,
                    answer: formattedReply,
                    intent: mode,
                    criterionKey,
                    usedFallback,
                    answerMetadata: { cards, responseMode, sectionKey },
                });
            } catch (persistError: any) {
                if (isMissingConsultantPersistenceError(persistError)) {
                    persistenceDisabled = true;
                    console.warn('[OKK Consultant] Failed to persist message because persistence schema is missing.');
                } else {
                    throw persistError;
                }
            }
        }

        return NextResponse.json({
            success: true,
            reply: formattedReply,
            cards,
            suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.order,
            threadId: thread?.id || null,
            traceId,
            responseMode,
            persistenceDisabled,
            orderContext: {
                orderId: order.order_id,
                manager: order.manager_name || '—',
                status: order.status_label || '—',
                totalScore: order.total_score ?? null,
            },
        });
    } catch (error: any) {
        console.error('[OKK Consultant]', error);
        return NextResponse.json({
            error: error.message || 'Не удалось получить ответ консультанта',
        }, { status: 500 });
    }
}
