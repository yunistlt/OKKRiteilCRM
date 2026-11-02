import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
    buildAmbiguousCriteriaSummary,
    buildConsultantMetaAnswer,
    buildCallEvidenceExplanation,
    buildCriterionExplanation,
    buildFormulaExplanation,
    buildEvidenceSummary,
    buildFailedCriteriaSummary,
    buildGeneralRatingExplanation,
    buildGlossaryAnswer,
    buildHistoryEvidenceExplanation,
    buildImprovementPlan,
    buildMissingDataSummary,
    buildOrderSourceExplanation,
    buildOrderContextForLLM,
    buildOrderScoreExplanation,
    buildResponseCards,
    buildSectionAnswer,
    buildTechnicalExplanation,
    buildViolationsReferenceAnswer,
    ConsultantOrder,
    ConsultantReplyKind,
    findConsultantSectionMention,
    findCriterionKey,
    findFormulaKey,
    findGlossaryTerm,
    getReplyCriterionKey,
    getConsultantSectionConfig,
    isConsultantMetaQuestion,
    isFormulaQuestion,
    isGlossaryQuestion,
    isOrderAnalysisSection,
    OKK_CONSULTANT_QUICK_QUESTIONS,
    OrderEvidence,
    sanitizeConsultantContextForRole,
    shouldShowOrderCards,
} from '@/lib/okk-consultant';
import { loadConsultantEvidence, loadConsultantOrder } from '@/lib/okk-consultant-context';
import {
    formatConsultantKnowledgeContext,
    getConsultantPromptConfig,
    searchConsultantKnowledge,
    summarizeHistoryForPrompt,
    renderConsultantTemplate,
} from '@/lib/okk-consultant-ai';
import { isMissingConsultantPersistenceError } from '@/lib/okk-consultant-persistence';
import { audiencesForRole, formatProjectKnowledgeContext, searchProjectKnowledge } from '@/lib/project-knowledge';
import { buildConsultantTools, executeConsultantTool, type ConsultantToolContext } from '@/lib/consultant-tools';
import { getOpenAIClient } from '@/utils/openai';
import { supabase } from '@/utils/supabase';
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';
import { isReasoningModel, modelTuning } from '@/lib/ai/model-compat';
import { logAssistantDialog } from '@/lib/assistant/dialog-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 10;
const MAX_HISTORY_TEXT_LENGTH = 600;
const REFERENCE_CACHE_TTL_MS = 1000 * 60 * 60;
const THREAD_TTL_DAYS = 30;
const MAX_FALLBACK_KNOWLEDGE_HITS = 4;
const MAX_GLOBAL_KNOWLEDGE_HITS = 5;
// text-embedding-3-small scores for question-vs-doc-prose cluster ~0.35-0.55 even when
// genuinely relevant (unlike the okk catalog KB, whose content mirrors question phrasing).
// Keep this low; the prompt instructs the model to ignore irrelevant context and say so.
const GLOBAL_KNOWLEDGE_THRESHOLD = 0.33;
/**
 * Сколько инструкций для сотрудников подмешиваем в глобальный ответ.
 *
 * До 02.11.2026 в глобальном чате их не было вовсе: Семён искал только в
 * документации репозитория и на вопрос «как отличить свою задачу от
 * системной» рассказывал про устройство ИИ-команды. Инструкции написаны
 * словами человека, поэтому идут первыми, а документация остаётся — по ней
 * он отвечает, как система устроена внутри.
 */
const MAX_GLOBAL_INSTRUCTION_HITS = 4;

const referenceAnswerCache = new Map<string, { reply: string; cachedAt: number }>();

type NormalizedHistoryItem = {
    role: 'agent' | 'user' | 'system';
    text: string;
    metadata?: Record<string, any> | null;
};

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

async function buildFallbackAnswer(
    question: string,
    order: ConsultantOrder | null,
    evidence: OrderEvidence | null,
    sectionKey: string,
    history: NormalizedHistoryItem[],
): Promise<{ reply: string | null; promptKey: string | null; knowledgeHits: Array<{ slug: string; type: string; similarity: number }> }> {
    if (!process.env.OPENAI_API_KEY) {
        return { reply: null, promptKey: null, knowledgeHits: [] };
    }

    const openai = getOpenAIClient();
    const section = getConsultantSectionConfig(sectionKey);
    const [mainPrompt, stylePrompt, knowledgeHits] = await Promise.all([
        getConsultantPromptConfig('okk_consultant_main_chat'),
        getConsultantPromptConfig('okk_consultant_style_guardrail'),
        searchConsultantKnowledge(question, section.key, MAX_FALLBACK_KNOWLEDGE_HITS),
    ]);
    const userPrompt = renderConsultantTemplate(mainPrompt.userPromptTemplate, {
        question,
        section_title: section.title,
        section_summary: section.summary,
        knowledge_context: formatConsultantKnowledgeContext(knowledgeHits),
        history_context: summarizeHistoryForPrompt(history),
        order_context: order ? buildOrderContextForLLM(order, evidence) : 'Контекст заказа не выбран.',
    });
    const completion = await openai.chat.completions.create({
        model: mainPrompt.model,
        // Новые модели требуют другой набор параметров — см. lib/ai/model-compat.
        // Без этого смена модели в настройках роняет ветку с 400.
        ...modelTuning({
            model: mainPrompt.model,
            maxTokens: mainPrompt.maxTokens,
            temperature: mainPrompt.temperature,
            reasoningEffort: 'low',
        }),
        messages: [
            {
                role: 'system',
                content: `${mainPrompt.systemPrompt}\n\n${stylePrompt.systemPrompt}\n\nТекущий раздел: ${section.title}.`
            },
            {
                role: 'user',
                content: userPrompt,
            }
        ],
    });
    await recordAiUsage({ agentId: AiAgent.SEMEN, model: completion.model, usage: completion.usage, purpose: 'consultant_section_answer' });

    return {
        reply: completion.choices[0]?.message?.content || null,
        promptKey: mainPrompt.key,
        knowledgeHits: knowledgeHits.map((item) => ({
            slug: item.slug,
            type: item.type,
            similarity: item.similarity,
        })),
    };
}

/**
 * Контекст глобального ответа: сначала инструкции для сотрудников, потом
 * документация проекта. Порядок — часть ответа: модель берёт верхнее.
 */
function buildGlobalKnowledgeContext(
    instructions: Awaited<ReturnType<typeof searchConsultantKnowledge>>,
    docs: Awaited<ReturnType<typeof searchProjectKnowledge>>,
    sectionArticle: string | null = null,
): string {
    const parts: string[] = [];
    if (sectionArticle) {
        parts.push(`СТАТЬЯ СПРАВОЧНИКА, подобранная по словам вопроса. Она объясняет тему, но может не отвечать на заданный вопрос: если спрашивают про конкретные цифры, людей или период — иди за данными, а статью используй как объяснение:\n${sectionArticle}`);
    }
    if (instructions.length > 0) {
        parts.push(`ИНСТРУКЦИИ ДЛЯ СОТРУДНИКОВ — как человек работает в системе. Отвечай по ним в первую очередь:\n${formatConsultantKnowledgeContext(instructions)}`);
    }
    if (docs.length > 0) {
        parts.push(`ДОКУМЕНТАЦИЯ ПРОЕКТА — как система устроена внутри. Бери её, когда спрашивают об устройстве, а не о работе:\n${formatProjectKnowledgeContext(docs)}`);
    }
    return parts.length > 0 ? parts.join('\n\n') : 'Подходящие записи в базе знаний не найдены.';
}

async function buildGlobalKnowledgeAnswer(
    question: string,
    sectionKey: string,
    history: NormalizedHistoryItem[],
    userRole: string,
    retailCrmManagerId: number | null,
    contextHint: string | null = null,
    /** Готовая статья справочника раздела, если она нашлась по словам вопроса. */
    sectionArticle: string | null = null,
    /** Кто спрашивает: его именем подписывается поставленная задача. */
    actorName: string | null = null,
    actorUserId: string | null = null,
): Promise<{ reply: string | null; promptKey: string | null; knowledgeHits: Array<{ slug: string; subsystem: string | null; similarity: number }>; toolCalls: Array<{ name: string }> }> {
    if (!process.env.OPENAI_API_KEY) {
        return { reply: null, promptKey: null, knowledgeHits: [], toolCalls: [] };
    }

    // Экран пользователя подмешиваем в поисковый запрос — смещаем выдачу к теме активной вкладки.
    const searchQuery = contextHint ? `${question}\n\n(Экран пользователя: ${contextHint})` : question;
    // Две базы: инструкции для сотрудников (та же, что открывается «Справкой»)
    // и документация проекта. Раньше спрашивали только вторую.
    const [docHits, instructionHits] = await Promise.all([
        searchProjectKnowledge(searchQuery, audiencesForRole(userRole), MAX_GLOBAL_KNOWLEDGE_HITS, GLOBAL_KNOWLEDGE_THRESHOLD),
        searchConsultantKnowledge(searchQuery, null, MAX_GLOBAL_INSTRUCTION_HITS),
    ]);
    const hits = [
        ...instructionHits.map((hit) => ({ slug: hit.slug, subsystem: 'инструкция', similarity: hit.similarity })),
        ...docHits.map((hit) => ({ slug: hit.slug, subsystem: hit.subsystem, similarity: hit.similarity })),
    ];

    // Раньше тут был ранний выход при отсутствии знаний и менеджера. Теперь у консультанта
    // всегда есть инструмент данных (orders_aggregate), поэтому tool-loop запускаем и без hits —
    // иначе вопросы вида «средний чек по заявкам» некому было бы посчитать.

    const openai = getOpenAIClient();
    const section = getConsultantSectionConfig(sectionKey);
    const [mainPrompt, stylePrompt] = await Promise.all([
        getConsultantPromptConfig('okk_consultant_global_chat'),
        getConsultantPromptConfig('okk_consultant_style_guardrail'),
    ]);
    const userPrompt = renderConsultantTemplate(mainPrompt.userPromptTemplate, {
        question,
        section_title: section.title,
        knowledge_context: buildGlobalKnowledgeContext(instructionHits, docHits, sectionArticle),
        history_context: summarizeHistoryForPrompt(history),
    });

    const now = new Date();
    const toolCtx: ConsultantToolContext = {
        retailCrmManagerId,
        userRole,
        defaultYear: now.getFullYear(),
        defaultMonth: now.getMonth() + 1,
        // Задачу ставит человек, Семён только записывает — подпись и автор его.
        actorName,
        actorUserId,
    };
    const tools = buildConsultantTools(toolCtx);

    let systemContent = `${mainPrompt.systemPrompt}\n\n${stylePrompt.systemPrompt}\n\nТекущий раздел: ${section.title}.`;
    if (contextHint) {
        systemContent += `\n\nПользователь сейчас находится на экране: «${contextHint}». Если вопрос задан без явного указания раздела, считай, что он про этот экран, и ищи ответ в соответствующей теме.`;
    }
    // Источник учёта один — наша база. RetailCRM отвязали 09.10.2026, и она
    // больше не пополняется: спрашивать у неё «что сейчас» значит отвечать
    // позапрошлым месяцем.
    systemContent += '\n\nВсе данные бери из нашей базы: заказы, клиенты, оплаты, звонки, оценки и зарплата живут только у нас. RetailCRM — архив на чтение, он не пополняется с 09.10.2026, и в ответах на него не ссылайся.';

    systemContent += '\n\nПорядок работы. Сначала реши, ОТКУДА брать ответ, и только потом отвечай. Вопрос про конкретные цифры, людей, заказы, клиентов или период («у кого», «сколько», «за октябрь», «покажи») — это ДАННЫЕ: бери их инструментами, статьёй справочника такой вопрос не закрывается. Вопрос «что это», «как считается», «почему так устроено» — это ЗНАНИЯ: отвечай по инструкциям и статьям. Вопрос «как именно работает фича» и в знаниях ответа нет — смотри код. Нужны и знания, и цифры — возьми и то и другое. Если данных нет или инструмент вернул пусто, так и скажи и объясни, почему: выдуманное число хуже честного «нет данных».';

    systemContent += '\n\nВ знаниях у тебя два пласта. ИНСТРУКЦИИ ДЛЯ СОТРУДНИКОВ — как человек работает в системе: где нажать, почему так считается, что означает отметка. На вопросы «как», «почему у меня», «где посмотреть» отвечай по ним и словами инструкции. ДОКУМЕНТАЦИЯ ПРОЕКТА — как система устроена внутри; бери её, когда спрашивают про устройство, или когда в инструкциях ответа нет. Если ответа нет нигде — так и скажи, не придумывай.';

    systemContent += '\n\nПисьмо клиенту ты готовишь, но не отправляешь: вызови draft_client_email, приведи в ответе тему и текст целиком и скажи, что письмо уйдёт после нажатия «Отправить» — подтверждает тот, кто просил его написать. Пиши готовый текст, без пропусков вида «[укажите срок]»: не хватает данных — сначала спроси. Так же со звонком: call_client только готовит набор.';

    systemContent += '\n\nТы не только объясняешь — ты помогаешь делать. Просят найти заказ — ищи orders_find по номеру, клиенту или статусу. Просят разобрать день — бери day_plan: там видно, что уже отработано, а что нет, и почему заказ попал в план. Просят поставить задачу или напомнить — ставь create_order_task и скажи, по какому заказу и на какой срок поставил. Задачу ставь только по прямой просьбе, не по своей догадке. Письма ты пока не отправляешь: составь текст в ответе, отправит человек.';

    systemContent += '\n\nПро клиента спрашивают так же часто, как про заказ: «что за клиент», «чей он», «сколько покупал», «есть ли другие юрлица». На это есть client_dossier — он ищет по названию, ИНН или номеру карточки и отдаёт карточку, ответственного менеджера, группу компаний и последние заказы. Нашлось несколько карточек одного покупателя — скажи об этом человеку, не выбирай за него.';

    systemContent += '\n\nЕсли ни инструкции, ни документация не объясняют, КАК работает фича, смотри сам код: code_search найдёт место по имени настройки, таблицы или функции, code_read прочитает файл, code_files покажет, где что лежит. Отвечай словами человека, а не листингом: что происходит, от чего зависит, где это настраивается. Код приводи только если спросили прямо. Снимок кода снимается не каждый день — называй его дату, когда ответ опирается на код.';

    systemContent += '\n\nДля ЛЮБЫХ числовых вопросов (зарплата, рейтинг ОКК, метрики по заказам, «что если», сравнения сценариев) ВЫЗЫВАЙ инструменты и опирайся только на их результат — не считай в уме и не выдумывай числа. orders_aggregate — для метрик по заказам/заявкам (средний чек, количество, сумма): для «успешных / переданных в производство / завершённых за период» вызывай с date_basis="production" (считается по дате перехода в производство), для метрик по дате создания/текущему статусу — date_basis="created"; simulate_salary — для зарплатных «что если»; get_my_rating/how_to_improve_my_rating — для рейтинга; calc — для произвольной арифметики. Озвучивай, какие фильтры (статусы/период) были применены. Если инструмент вернул available:false — честно скажи, что данных нет.';

    const messages: any[] = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
    ];
    const usedTools: Array<{ name: string }> = [];
    // У рассуждающих моделей размышление тратится из того же лимита, что и
    // ответ: с прежними 420 токенами на сам ответ не осталось бы ничего.
    const maxTokens = isReasoningModel(mainPrompt.model)
        ? Math.max(mainPrompt.maxTokens, 2500)
        : Math.max(mainPrompt.maxTokens, 600);

    // Кругов работы инструментами столько же, сколько у Тамары: на вопрос, который
    // требует трёх-четырёх запросов подряд, пяти не хватало — Семён обрывался на
    // середине и отвечал, что не нашёл данных. Инструменты только читают и
    // ограничены правами спрашивающего, поэтому длинная цепочка безопасна.
    for (let iteration = 0; iteration < 30; iteration += 1) {
        const completion = await openai.chat.completions.create({
            model: mainPrompt.model,
            // Новые модели требуют другой набор параметров — см. lib/ai/model-compat.
            ...modelTuning({
                model: mainPrompt.model,
                maxTokens,
                temperature: mainPrompt.temperature,
                // Рассуждение здесь просить нельзя: gpt-5.5 в /v1/chat/completions
                // отвечает 400 на связку «инструменты + reasoning_effort», а без
                // инструментов Семён не ответит ни про заказы, ни про клиентов
                // (проверено на боевой модели 02.11.2026). Порядок рассуждения
                // задан промптом, а глубину даёт сама модель.
                reasoningEffort: 'none',
            }),
            messages,
            tools,
        } as any);
        await recordAiUsage({ agentId: AiAgent.SEMEN, model: completion.model, usage: completion.usage, purpose: 'consultant_global_answer' });

        const choice = completion.choices[0]?.message;
        if (!choice) break;

        if (choice.tool_calls?.length) {
            messages.push(choice);
            for (const call of choice.tool_calls) {
                if (call.type !== 'function') continue;
                let args: any = {};
                try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
                const result = await executeConsultantTool(call.function.name, args, toolCtx);
                usedTools.push({ name: call.function.name });
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            }
            continue;
        }

        void logAssistantDialog({
            channel: 'web',
            question,
            answer: choice.content || '',
            model: mainPrompt.model,
            tools: usedTools.map((t) => t.name),
            intent: 'global',
        });

        return {
            reply: choice.content || null,
            promptKey: mainPrompt.key,
            knowledgeHits: hits.map((item) => ({ slug: item.slug, subsystem: item.subsystem, similarity: item.similarity })),
            toolCalls: usedTools,
        };
    }

    return {
        reply: null,
        promptKey: mainPrompt.key,
        knowledgeHits: hits.map((item) => ({ slug: item.slug, subsystem: item.subsystem, similarity: item.similarity })),
        toolCalls: usedTools,
    };
}

function normalizeHistory(history: unknown): NormalizedHistoryItem[] {
    if (!Array.isArray(history)) return [];

    return history
        .filter((item) => item && typeof item === 'object')
        .map((item: any) => ({
            role: item.role === 'agent' || item.role === 'user' || item.role === 'system' ? item.role : 'user',
            text: String(item.text || '').slice(0, MAX_HISTORY_TEXT_LENGTH).trim(),
            metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : null,
        }))
        .filter((item) => item.text)
        .slice(-MAX_HISTORY_ITEMS);
}

function isSectionFollowupQuestion(message: string): boolean {
    const lower = message.toLowerCase();

    return lower.includes('при чем тут')
        || lower.includes('я спрашиваю про')
        || lower.includes('я спрашивал про')
        || lower.includes('я имею в виду')
        || lower.includes('не про заказ')
        || lower.includes('не про рейтинг')
        || lower.includes('про этот раздел')
        || lower.includes('про этот экран')
        || lower.includes('про раздел')
        || lower.includes('про экран');
}

function inferReplyKindFromMetadata(metadata: Record<string, any> | null | undefined): ConsultantReplyKind | null {
    if (!metadata || typeof metadata !== 'object') return null;
    if (typeof metadata.replyKind === 'string') return metadata.replyKind as ConsultantReplyKind;
    if (typeof metadata.criterion_key === 'string' && metadata.criterion_key) return 'criterion';
    if (metadata.fallbackPromptKey || metadata.fallbackKnowledgeHits) return 'fallback';

    switch (metadata.intent) {
        case 'source': return 'order-source';
        case 'score': return 'score';
        case 'proof': return 'proof';
        case 'technical': return 'technical';
        case 'fix': return 'fix';
        case 'failures': return 'failures';
        case 'ambiguous': return 'ambiguous';
        case 'missing': return 'missing';
        default: return null;
    }
}

function resolveHistorySectionKey(metadata: Record<string, any> | null | undefined, fallbackSectionKey: string): string | null {
    if (!metadata || typeof metadata !== 'object') return null;

    if (typeof metadata.sectionKey === 'string') {
        return getConsultantSectionConfig(metadata.sectionKey).key;
    }

    const legacyReplyKind = inferReplyKindFromMetadata(metadata);
    return legacyReplyKind === 'section' ? fallbackSectionKey : null;
}

function resolveAnswerSectionKey(sectionKey: string, message: string, history: NormalizedHistoryItem[]): string {
    const explicitSection = findConsultantSectionMention(message);
    if (explicitSection) {
        return explicitSection.key;
    }

    if (!isSectionFollowupQuestion(message)) {
        return sectionKey;
    }

    for (const item of [...history].reverse()) {
        if (item.role !== 'agent') continue;

        const historySectionKey = resolveHistorySectionKey(item.metadata, sectionKey);

        if (historySectionKey) {
            return historySectionKey;
        }

        if (inferReplyKindFromMetadata(item.metadata) === 'section') {
            return sectionKey;
        }
    }

    return sectionKey;
}

function buildSuccessResponse(params: {
    reply: string;
    suggestions: readonly string[];
    replyKind: ConsultantReplyKind;
    sectionKey: string;
    cards?: any[];
    threadId?: string | null;
    traceId?: string | null;
    persistenceDisabled?: boolean;
    answerSource?: 'deterministic' | 'ai_generated';
    answerMetadata?: Record<string, any> | null;
    orderContext?: Record<string, any>;
}) {
    return NextResponse.json({
        success: true,
        reply: params.reply,
        cards: params.cards || [],
        suggestions: params.suggestions,
        threadId: params.threadId || null,
        traceId: params.traceId || null,
        persistenceDisabled: params.persistenceDisabled || false,
        answerSource: params.answerSource || 'deterministic',
        answerMetadata: {
            replyKind: params.replyKind,
            sectionKey: params.sectionKey,
            ...(params.answerMetadata || {}),
        },
        ...(params.orderContext ? { orderContext: params.orderContext } : {}),
    });
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
        }

        const body = await req.json();
        const message = String(body.message || '').trim();
        const orderIdRaw = body.orderId;
        const history = normalizeHistory(body.history);
        const threadIdRaw = typeof body.threadId === 'string' ? body.threadId : null;
        const sectionKey = normalizeSectionKey(body.sectionKey);
        const selectionContext = body.selectionContext && typeof body.selectionContext === 'object' ? body.selectionContext : null;
        // Человекочитаемая подсказка об активном экране/вкладке пользователя (см. ConsultantScreenContext).
        const contextHint = typeof body.contextHint === 'string' && body.contextHint.trim() ? body.contextHint.trim().slice(0, 200) : null;

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

        const effectiveSectionKey = resolveAnswerSectionKey(sectionKey, message, history);
        const criterionKey = findCriterionKey(message);
        const formulaKey = findFormulaKey(message);
        const glossaryTerm = findGlossaryTerm(message);
        const mode = detectMode(message);
        const referenceQuestion = isReferenceQuestion(message.toLowerCase()) || isGlossaryQuestion(message);
        const userRole = session.user.role || 'admin';
        const retailCrmManagerId = session.user.retail_crm_manager_id ? Number(session.user.retail_crm_manager_id) : null;
        const userId = String(session.user.id);
        const username = String(session.user.username || 'user');

        /**
         * Отвечаем и пишем разговор в журнал.
         *
         * Раньше в журнал попадали только ответы модели, а готовые ответы
         * справочника — нет. Из-за этого случай «спросил про грейды за
         * октябрь — получил статью про грейды» (02.11.2026) не было видно
         * никому, кроме самого спросившего.
         */
        const respond: typeof buildSuccessResponse = (params) => {
            if ((params.answerSource ?? 'deterministic') !== 'ai_generated') {
                void logAssistantDialog({
                    channel: 'web',
                    question: message,
                    answer: params.reply,
                    intent: params.replyKind,
                    userId,
                    username,
                    managerId: retailCrmManagerId,
                    orderId: orderId ?? undefined,
                    threadId: params.threadId ?? undefined,
                });
            }
            return buildSuccessResponse(params);
        };
        const violationsReferenceQuestion = isViolationsReferenceQuestion(message);
        const sectionReply = buildSectionAnswer(effectiveSectionKey, message, selectionContext);

        if (isConsultantMetaQuestion(message)) {
            return respond({
                reply: buildConsultantMetaAnswer(getConsultantSectionConfig(effectiveSectionKey).title),
                suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
                replyKind: 'meta',
                sectionKey: effectiveSectionKey,
            });
        }

        // Отказ «не разбираю конкретные заказы» снят 02.11.2026. Он писался,
        // когда у Семёна не было доступа к данным: спросить было нечем.
        // Теперь есть order_dossier по номеру заказа и client_dossier по
        // названию или ИНН, и владелец решил, что Семён отвечает и по
        // заказам, и по клиентам. Чего не знает — скажет сам.

        // Просьба «выберите заказ в таблице» тоже снята: номер заказа чаще
        // всего назван прямо в вопросе, а по нему Семён поднимает досье сам.
        // Если номера нет, он спросит его словами — это лучше, чем отказ.

        if (!orderId) {
            // Справки — нарушения, формула, термин, критерий ОКК — больше не
            // отвечают за Семёна. Они совпадали по словам и перебивали просьбу:
            // на «напиши клиенту письмо по заказу 41989» он выдавал описание
            // критерия «При отсутствии ответа клиенту отправлено письмо»
            // (02.11.2026). Теперь всё найденное уходит модели подсказкой, а
            // решает она — так же, как со статьёй раздела.
            const referenceNotes = [
                violationsReferenceQuestion ? buildViolationsReferenceAnswer(null) : null,
                formulaKey && isFormulaQuestion(message)
                    ? getCachedReferenceAnswer(`formula:${formulaKey}`, () => buildFormulaExplanation(formulaKey))
                    : null,
                glossaryTerm && isGlossaryQuestion(message)
                    ? getCachedReferenceAnswer(`glossary:${glossaryTerm.key}`, () => buildGlossaryAnswer(glossaryTerm))
                    : null,
                criterionKey
                    ? getCachedReferenceAnswer(`criterion:${criterionKey}:general`, () => buildCriterionExplanation({
                        order: { order_id: 0, score_breakdown: null },
                        criterionKey,
                        mode: 'general',
                    }))
                    : null,
                sectionReply,
            ].filter((x): x is string => Boolean(x));

            // Статья справочника раздела больше не отдаётся как готовый ответ.
            // Она совпадала по слову-триггеру и не смотрела, о чём спросили: на
            // «по итогам октября у кого какой грейд» человек получал статью
            // «что такое грейд» — мимо модели и мимо данных (02.11.2026).
            // Теперь решает модель: статья идёт ей подсказкой, рядом с данными,
            // знаниями и кодом (решение владельца — «сначала рассуждать,
            // откуда брать ответ, потом отвечать»).

            // Project-wide RAG + salary tools: answer methodology questions and personal salary
            // calculations across all sections. Salary tools are bound to the session user.
            const globalKnowledge = await buildGlobalKnowledgeAnswer(
                message,
                effectiveSectionKey,
                history,
                userRole,
                retailCrmManagerId,
                contextHint,
                referenceNotes.length > 0 ? referenceNotes.join('\n\n---\n\n') : null,
                [session.user.last_name, session.user.first_name].filter(Boolean).join(' ') || username,
                userId,
            );
            if (globalKnowledge.reply) {
                return respond({
                    reply: globalKnowledge.reply,
                    suggestions: isOrderAnalysisSection(effectiveSectionKey) ? OKK_CONSULTANT_QUICK_QUESTIONS.global : [],
                    replyKind: 'fallback',
                    sectionKey: effectiveSectionKey,
                    answerSource: 'ai_generated',
                    answerMetadata: {
                        fallbackPromptKey: globalKnowledge.promptKey,
                        fallbackKnowledgeHits: globalKnowledge.knowledgeHits,
                        toolCalls: globalKnowledge.toolCalls,
                        knowledgeBase: 'project',
                    },
                });
            }

            // No docs hit. For OKK keep the deterministic rating explanation; elsewhere say so honestly.
            if (isOrderAnalysisSection(effectiveSectionKey)) {
                return respond({
                    reply: getCachedReferenceAnswer('general:rating', () => buildGeneralRatingExplanation()),
                    suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.global,
                    replyKind: 'score',
                    sectionKey: effectiveSectionKey,
                });
            }

            return respond({
                reply: 'Я пока не нашёл ответ на этот вопрос в базе знаний проекта. Попробуйте переформулировать или уточнить, о каком разделе речь.',
                suggestions: [],
                replyKind: 'section',
                sectionKey: effectiveSectionKey,
            });
        }

        const [rawOrder, rawEvidence] = await Promise.all([
            loadConsultantOrder(orderId, userRole, retailCrmManagerId),
            loadConsultantEvidence(orderId),
        ]);
        const { order, evidence } = sanitizeConsultantContextForRole({
            order: rawOrder,
            evidence: rawEvidence,
            role: userRole,
        });

        let thread: { id: string } | null = null;
        let persistenceDisabled = false;

        try {
            thread = await getOrCreateThread(userId, username, orderId, threadIdRaw, effectiveSectionKey);
        } catch (threadError: any) {
            if (isMissingConsultantPersistenceError(threadError)) {
                persistenceDisabled = true;
                console.warn('[OKK Consultant] Persistence schema is missing, continuing in ephemeral mode.');
            } else {
                throw threadError;
            }
        }

        let reply: string;
        let replyKind: ConsultantReplyKind;
        let usedFallback = false;
        let answerMetadata: Record<string, any> | null = null;
        if (sectionReply) {
            reply = sectionReply;
            replyKind = 'section';
        } else if (violationsReferenceQuestion) {
            reply = buildViolationsReferenceAnswer(order);
            replyKind = 'violations-reference';
        } else if (formulaKey && isFormulaQuestion(message)) {
            reply = buildFormulaExplanation(formulaKey);
            replyKind = 'formula';
        } else if (glossaryTerm && isGlossaryQuestion(message)) {
            reply = buildGlossaryAnswer(glossaryTerm);
            replyKind = 'glossary';
        } else if (criterionKey) {
            reply = buildCriterionExplanation({
                order,
                criterionKey,
                mode: mode === 'source' ? 'source' : mode === 'fix' ? 'fix' : 'why',
                evidence,
            });
            replyKind = 'criterion';
        } else if (mode === 'source') {
            reply = buildOrderSourceExplanation(order, evidence);
            replyKind = 'order-source';
        } else if (mode === 'score') {
            reply = buildOrderScoreExplanation(order);
            replyKind = 'score';
        } else if (mode === 'proof') {
            reply = /событ|истори/i.test(message)
                ? buildHistoryEvidenceExplanation(order, evidence)
                : /звон|разговор|автоответ|ivr/i.test(message)
                    ? buildCallEvidenceExplanation(order, evidence)
                    : buildEvidenceSummary(order, evidence);
            replyKind = 'proof';
        } else if (mode === 'ambiguous') {
            reply = buildAmbiguousCriteriaSummary(order);
            replyKind = 'ambiguous';
        } else if (mode === 'missing') {
            reply = buildMissingDataSummary(order);
            replyKind = 'missing';
        } else if (mode === 'technical') {
            reply = userRole === 'manager'
                ? `${buildEvidenceSummary(order, evidence)}\n\nТехнические детали скрыты для роли менеджера по умолчанию. Если нужен глубокий разбор, его должен открыть ОКК или администратор.`
                : buildTechnicalExplanation(order, evidence);
            replyKind = 'technical';
        } else if (mode === 'fix') {
            reply = buildImprovementPlan(order);
            replyKind = 'fix';
        } else if (mode === 'failures') {
            reply = buildFailedCriteriaSummary(order);
            replyKind = 'failures';
        } else {
            const fallback = await buildFallbackAnswer(message, order, evidence, effectiveSectionKey, history);
            reply = fallback?.reply || buildOrderScoreExplanation(order);
            usedFallback = Boolean(fallback?.reply);
            replyKind = fallback?.reply ? 'fallback' : 'score';
            if (fallback?.reply) {
                answerMetadata = {
                    fallbackPromptKey: fallback.promptKey,
                    fallbackKnowledgeHits: fallback.knowledgeHits,
                };
            }
        }

        const effectiveCriterionKey = getReplyCriterionKey(replyKind, criterionKey);
        const cards = shouldShowOrderCards(replyKind)
            ? buildResponseCards({
                order,
                mode,
                criterionKey: effectiveCriterionKey,
                evidence,
            })
            : [];
        const formattedReply = reply;

        // Разговор пишем ВСЕГДА, а не только когда у него есть ветка: именно из-за
        // этого условия веб-чат молчал в журнале, хотя вопросы ему задавали.
        void logAssistantDialog({
            channel: 'web',
            question: message,
            answer: formattedReply,
            userId,
            username,
            orderId,
            threadId: thread?.id ?? null,
            // Вид ответа важнее режима: часть ответов здесь собирает код, а не модель.
            intent: `${mode}/${replyKind}`,
            usedFallback,
        });

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
                    criterionKey: effectiveCriterionKey,
                    usedFallback,
                    answerMetadata: {
                        cards,
                        sectionKey: effectiveSectionKey,
                        replyKind,
                        routingKind: sectionReply ? 'section' : replyKind,
                        ...(answerMetadata || {}),
                    },
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

        return respond({
            reply: formattedReply,
            cards,
            suggestions: OKK_CONSULTANT_QUICK_QUESTIONS.order,
            threadId: thread?.id || null,
            traceId,
            persistenceDisabled,
            answerSource: usedFallback ? 'ai_generated' : 'deterministic',
            replyKind,
            sectionKey: effectiveSectionKey,
            answerMetadata: {
                routingKind: sectionReply ? 'section' : replyKind,
                ...(answerMetadata || {}),
            },
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
