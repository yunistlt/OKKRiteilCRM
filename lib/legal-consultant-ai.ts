import { generateEmbedding, formatConsultantKnowledgeForEmbedding } from '@/lib/embeddings';
import type { AppRole } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { buildLegalKnowledgeSeedRows } from '@/lib/legal-consultant-kb';
import { canSeeLegalAudience } from '@/lib/legal-consultant';

export type LegalPromptKey = 'legal_consultant_main_chat' | 'legal_consultant_style_guardrail';

export type LegalPromptConfig = {
    key: LegalPromptKey;
    systemPrompt: string;
    userPromptTemplate: string;
    model: string;
    temperature: number;
    maxTokens: number;
    metadata: Record<string, any>;
};

export type LegalKnowledgeHit = {
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

export const DEFAULT_LEGAL_PROMPTS: Record<LegalPromptKey, LegalPromptConfig> = {
    legal_consultant_main_chat: {
        key: 'legal_consultant_main_chat',
        systemPrompt: 'Ты внутренний юрисконсульт компании. Отвечай только по базе знаний и явно переданному контексту. Если данных недостаточно, говори об этом прямо и предлагай эскалацию. Не раскрывай закрытые внутренние правила пользователям без соответствующей роли.',
        userPromptTemplate: [
            'Вопрос: {{question}}',
            'Intent: {{intent}}',
            'Раздел: {{section_title}}',
            'Стратегия fallback: {{fallback_strategy}}',
            '',
            'Релевантные знания:',
            '{{knowledge_context}}',
            '',
            'История диалога:',
            '{{history_context}}',
            '',
            'Санитизированный контекст:',
            '{{sanitized_context}}',
        ].join('\n'),
        model: 'gpt-4o-mini',
        temperature: 0.05,
        maxTokens: 360,
        metadata: { owner: 'legal_consultant', stage: 'production' },
    },
    legal_consultant_style_guardrail: {
        key: 'legal_consultant_style_guardrail',
        systemPrompt: 'Формат ответа: короткий вывод, затем до трех оснований из базы знаний. Если вопрос вне покрытия, скажи это одной фразой. Не рассуждай абстрактно и не имитируй внешнюю юридическую консультацию.',
        userPromptTemplate: '',
        model: 'gpt-4o-mini',
        temperature: 0.05,
        maxTokens: 220,
        metadata: { owner: 'legal_consultant', stage: 'production', style: 'concise' },
    },
};

function normalizePromptRecord(key: LegalPromptKey, data: any): LegalPromptConfig {
    const fallback = DEFAULT_LEGAL_PROMPTS[key];

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

export async function getLegalPromptConfig(key: LegalPromptKey): Promise<LegalPromptConfig> {
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
        console.warn(`[Legal Consultant] Failed to load prompt ${key} from DB, using default.`, error);
    }

    return DEFAULT_LEGAL_PROMPTS[key];
}

export function renderLegalTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => values[key] || '—');
}

function formatLegalKnowledgeContext(hits: LegalKnowledgeHit[]): string {
    if (hits.length === 0) {
        return 'Подходящие записи в базе знаний не найдены.';
    }

    return hits.map((hit, index) => {
        const tags = Array.isArray(hit.tags) && hit.tags.length > 0 ? `Теги: ${hit.tags.join(', ')}.` : '';
        const source = hit.source_ref ? `Источник: ${hit.source_ref}.` : '';
        return [
            `${index + 1}. [${hit.type}] ${hit.title}`,
            hit.content,
            tags,
            source,
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}

function searchLocalLegalKnowledge(query: string, role: AppRole, sectionKey?: string | null): LegalKnowledgeHit[] {
    const normalized = query.toLowerCase();

    return buildLegalKnowledgeSeedRows()
        .filter((row) => (!sectionKey || row.sectionKey === sectionKey))
        .filter((row) => canSeeLegalAudience(role, row.metadata?.audience))
        .map((row) => {
            const haystack = formatConsultantKnowledgeForEmbedding(row).toLowerCase();
            const terms = normalized.split(/\s+/).filter(Boolean);
            const matches = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
            return {
                id: row.slug,
                slug: row.slug,
                type: row.type,
                section_key: row.sectionKey,
                title: row.title,
                content: row.content,
                tags: row.tags,
                source_ref: row.sourceRef,
                metadata: row.metadata || null,
                similarity: terms.length > 0 ? matches / terms.length : 0,
            };
        })
        .filter((row) => row.similarity > 0)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 4);
}

export async function searchLegalKnowledge(
    query: string,
    role: AppRole,
    sectionKey?: string | null,
    matchCount: number = 4,
    threshold: number = 0.58,
): Promise<LegalKnowledgeHit[]> {
    if (!query.trim()) return [];

    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_legal_consultant_knowledge', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: matchCount,
            requested_section_key: sectionKey || null,
        });

        if (error) throw error;

        return (Array.isArray(data) ? data : []).filter((item) => canSeeLegalAudience(role, item?.metadata?.audience));
    } catch (error) {
        console.warn('[Legal Consultant] Knowledge search failed, using local fallback.', error);
        return searchLocalLegalKnowledge(query, role, sectionKey);
    }
}

export { formatLegalKnowledgeContext };