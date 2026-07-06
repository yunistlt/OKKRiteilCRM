// Векторный поиск по РАГ-базе бота (dialog_knowledge) через RPC match_dialog_knowledge.
// По умолчанию only_bot_answerable=true — бот физически не достаёт спорные знания.
import { supabase } from '@/utils/supabase';
import { generateEmbedding } from '@/lib/embeddings';
import type { DialogHit } from './types';

export type SearchOptions = {
    topK?: number;
    threshold?: number;
    onlyBotAnswerable?: boolean;
    domain?: string | null;
};

export async function searchDialogKnowledge(
    query: string,
    { topK = 5, threshold = 0.45, onlyBotAnswerable = true, domain = null }: SearchOptions = {},
): Promise<DialogHit[]> {
    if (!query.trim()) return [];

    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_dialog_knowledge', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: topK,
            only_bot_answerable: onlyBotAnswerable,
            filter_domain: domain,
        });
        if (error) throw error;
        return Array.isArray(data) ? (data as DialogHit[]) : [];
    } catch (error) {
        console.warn('[sales-bot] searchDialogKnowledge failed, continuing without hits.', error);
        return [];
    }
}

// Форматирование найденных приёмов для подстановки в промпт ответчика.
export function formatKnowledgeForPrompt(hits: DialogHit[]): string {
    if (!hits.length) return 'Похожих ситуаций в базе не нашлось.';
    return hits
        .map((h, i) => {
            const parts = [
                `${i + 1}. [${h.domain}${h.type ? '/' + h.type : ''}] (похожесть ${h.similarity.toFixed(2)})`,
                `Клиент спрашивал: ${h.situation}`,
                `Менеджер ответил: ${h.response}`,
            ];
            return parts.join('\n');
        })
        .join('\n\n');
}
