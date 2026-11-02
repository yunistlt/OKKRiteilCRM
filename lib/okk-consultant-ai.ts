import { generateEmbedding } from '@/lib/embeddings';
import type { ConsultantSectionKey } from '@/lib/okk-consultant';
import { supabase } from '@/utils/supabase';

export type ConsultantPromptKey = 'okk_consultant_main_chat' | 'okk_consultant_style_guardrail' | 'okk_consultant_global_chat';

export type ConsultantPromptConfig = {
    key: ConsultantPromptKey;
    systemPrompt: string;
    userPromptTemplate: string;
    model: string;
    temperature: number;
    maxTokens: number;
    metadata: Record<string, any>;
};

export type ConsultantKnowledgeHit = {
    id: string;
    slug: string;
    type: string;
    section_key: string | null;
    title: string;
    content: string;
    tags: string[] | null;
    source_ref: string | null;
    metadata: Record<string, any> | null;
    similarity: number;
};

/**
 * Настройки по умолчанию. Боевые значения живут в таблице `ai_prompts`, но
 * скрипт засева (`npm run okk:consultant-seed-kb`) переписывает их отсюда —
 * поэтому модель меняем в обоих местах, иначе следующий засев тихо вернёт
 * прежнюю.
 *
 * Модель: до 02.11.2026 Семён работал на gpt-4o-mini с потолком ответа в 420
 * токенов. Он не связывал вопрос с данными, путал годы и пересказывал первое
 * подвернувшееся. Переведён на рассуждающую модель по решению владельца —
 * сначала думает, откуда брать ответ, потом отвечает. Вызов дороже примерно в
 * полсотни раз; при нынешних двух-трёх десятках вопросов в день это доллары в
 * месяц, а не десятки.
 */
export const DEFAULT_CONSULTANT_PROMPTS: Record<ConsultantPromptKey, ConsultantPromptConfig> = {
    okk_consultant_main_chat: {
        key: 'okk_consultant_main_chat',
        systemPrompt: [
            'Ты консультант-методолог по ОКК.',
            'Отвечай только по данным из контекста и найденных знаний.',
            'Не выдумывай поля, звонки, формулы, правила и причины.',
            'Если данных недостаточно, скажи это прямо одной фразой.',
            'Не старайся угодить. Не используй длинные вступления, смягчения и общие рассуждения.',
            'Если вопрос про экран, раздел или режим работы, не подменяй ответ summary-подписью: сначала объясни назначение, затем как этим пользуются, затем что означает ключевой UI и какой результат получает пользователь.',
            'Если вопрос про поле, метрику или колонку, сначала дай смысл, затем источник данных, затем интерпретацию результата.',
            'Если вопрос про конкретный элемент экрана или режим, отвечай по сущности или режиму, а не пересказывай весь раздел целиком.',
            'Если вопрос про конкретный заказ, сначала дай вывод по факту, затем данные-основания, затем ограничение или следующий шаг только если он действительно нужен.',
            'Запрещено перечислять термины без объяснения пользовательского смысла.',
            'Если в знаниях есть отдельные section_entity или section_mode записи, они приоритетнее общего overview раздела.',
        ].join(' '),
        userPromptTemplate: [
            'Вопрос: {{question}}',
            'Раздел: {{section_title}}',
            'Краткое описание раздела: {{section_summary}}',
            '',
            'Релевантные знания:',
            '{{knowledge_context}}',
            '',
            'История диалога:',
            '{{history_context}}',
            '',
            'Контекст заказа:',
            '{{order_context}}',
        ].join('\n'),
        model: 'gpt-5.5',
        temperature: 0.05,
        maxTokens: 2500,
        metadata: { owner: 'okk_consultant', stage: 'production' },
    },
    okk_consultant_style_guardrail: {
        key: 'okk_consultant_style_guardrail',
        systemPrompt: [
            'Формат ответа: 1) прямой вывод, 2) до трех коротких фактов, 3) следующий шаг только если он реально нужен.',
            'Пиши кратко и по делу.',
            'Запрещено: вода, повтор вопроса, комплименты, канцелярит, длинные списки, уверенные догадки без опоры на контекст.',
            'Если есть неопределенность, обозначь ее одной короткой строкой.',
            'Для экранных вопросов допустимы 2 коротких абзаца вместо списка, если так понятнее объясняется назначение и рабочий сценарий.',
            'Для вопросов по сущности экрана или режиму не расползайся в обзор всего раздела.',
            'Не отвечай в стиле подписи интерфейса или словаря терминов, если пользователь просит объяснить как это работает.',
        ].join(' '),
        userPromptTemplate: '',
        model: 'gpt-4o-mini',
        temperature: 0.05,
        maxTokens: 280,
        metadata: { owner: 'okk_consultant', stage: 'production', style: 'concise' },
    },
    okk_consultant_global_chat: {
        key: 'okk_consultant_global_chat',
        systemPrompt: [
            'Ты Семён — консультант по всей системе OKKCRM: ОКК, зарплата ОП, мессенджер, ловец лидов, юридические агенты, настройки.',
            'Отвечай строго по найденным знаниям из базы документации проекта.',
            'Не выдумывай поля, формулы, цифры, правила и процессы.',
            'Если в найденных знаниях нет ответа, честно скажи об этом одной фразой и предложи переформулировать вопрос.',
            'Все ответы на русском.',
            'Не старайся угодить, без длинных вступлений и общих рассуждений.',
        ].join(' '),
        userPromptTemplate: [
            'Вопрос: {{question}}',
            'Раздел: {{section_title}}',
            '',
            'Найденные знания из документации:',
            '{{knowledge_context}}',
            '',
            'История диалога:',
            '{{history_context}}',
        ].join('\n'),
        model: 'gpt-5.5',
        temperature: 0.05,
        maxTokens: 2500,
        metadata: { owner: 'okk_consultant', stage: 'production', scope: 'project-wide' },
    },
};

function normalizePromptRecord(key: ConsultantPromptKey, data: any): ConsultantPromptConfig {
    const fallback = DEFAULT_CONSULTANT_PROMPTS[key];

    return {
        key,
        systemPrompt: String(data?.system_prompt || fallback.systemPrompt),
        userPromptTemplate: String(data?.user_prompt_template || fallback.userPromptTemplate),
        model: String(data?.model || fallback.model),
        temperature: typeof data?.temperature === 'number' ? data.temperature : fallback.temperature,
        maxTokens: typeof data?.max_tokens === 'number' ? data.max_tokens : fallback.maxTokens,
        metadata: data?.metadata && typeof data.metadata === 'object' ? data.metadata : fallback.metadata,
    };
}

export async function getConsultantPromptConfig(key: ConsultantPromptKey): Promise<ConsultantPromptConfig> {
    try {
        const { data } = await supabase
            .from('ai_prompts')
            .select('system_prompt, user_prompt_template, model, temperature, max_tokens, metadata')
            .eq('key', key)
            .eq('is_active', true)
            .maybeSingle();

        if (data) {
            return normalizePromptRecord(key, data);
        }
    } catch (error) {
        console.warn(`[OKK Consultant] Failed to load prompt ${key} from DB, using default.`, error);
    }

    return DEFAULT_CONSULTANT_PROMPTS[key];
}

export function renderConsultantTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => values[key] || '—');
}

/**
 * Насколько близко кусок знаний должен подходить вопросу, чтобы пойти в ответ.
 *
 * Было 0.58, и разговорный вопрос до порога не дотягивал: «поиск не находит
 * нужный шкаф» давало 0.56, «как отличить свою задачу от системной» — 0.54,
 * «что за задача про ИНН, я её не ставила» — 0.45. Нужный раздел при этом
 * всегда стоял первым: дело было не в знаниях, а в отсечке — Семён молчал,
 * имея ответ под рукой (замер и решение владельца 02.11.2026).
 *
 * Порог один на всех, кто спрашивает базу знаний: и чат Семёна, и помощник
 * бота-РОПа, и ответы по товару.
 */
export const CONSULTANT_KNOWLEDGE_THRESHOLD = 0.5;

export async function searchConsultantKnowledge(
    query: string,
    sectionKey?: ConsultantSectionKey | string | null,
    matchCount: number = 4,
    threshold: number = CONSULTANT_KNOWLEDGE_THRESHOLD,
): Promise<ConsultantKnowledgeHit[]> {
    if (!query.trim()) return [];

    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_okk_consultant_knowledge', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: matchCount,
            requested_section_key: sectionKey || null,
        });

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.warn('[OKK Consultant] Knowledge search failed, continuing without KB hits.', error);
        return [];
    }
}

// --- Product FAQ knowledge retrieval ---
// Если intent 'product_faq', ищем ответ в базе знаний
export async function getProductFaqAnswer(question: string): Promise<string | null> {
  const hits = await searchConsultantKnowledge(question, null, 3);
  if (hits.length === 0) {
    return 'Извините, по вашему вопросу пока нет ответа в базе знаний. Ваш запрос будет передан для доработки.';
  }
  return hits.map(h => h.content).join('\n---\n');
}

export function formatConsultantKnowledgeContext(hits: ConsultantKnowledgeHit[]): string {
    if (hits.length === 0) {
        return 'Подходящие записи в базе знаний не найдены.';
    }

    return hits.map((hit, index) => {
        const tags = Array.isArray(hit.tags) && hit.tags.length > 0 ? `Теги: ${hit.tags.join(', ')}.` : '';
        const source = hit.source_ref ? `Источник: ${hit.source_ref}.` : '';
        const similarity = Number.isFinite(hit.similarity) ? `Similarity: ${hit.similarity.toFixed(3)}.` : '';

        return [
            `${index + 1}. [${hit.type}] ${hit.title}`,
            hit.content,
            tags,
            source,
            similarity,
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}

export function summarizeHistoryForPrompt(history: Array<{ role: string; text: string }>): string {
    if (history.length === 0) return 'Истории нет.';

    return history
        .slice(-6)
        .map((item) => `${item.role}: ${item.text}`)
        .join('\n');
}