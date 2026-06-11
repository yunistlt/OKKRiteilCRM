import { generateEmbedding } from '@/lib/embeddings';
import { supabase } from '@/utils/supabase';

// Project-wide knowledge base ("умный Семён"): RAG over the project's markdown docs.
// Sibling to okk_consultant_knowledge but audience-scoped and not catalog-materialized.

export type ProjectAudience = 'all' | 'staff';

export type ProjectKnowledgeHit = {
    id: string;
    slug: string;
    source_path: string;
    subsystem: string | null;
    heading: string | null;
    title: string;
    content: string;
    audience: ProjectAudience;
    tags: string[] | null;
    metadata: Record<string, any> | null;
    similarity: number;
};

/**
 * Maps a user role to the document audiences they are allowed to see.
 * Staff-only docs (internal architecture, pipelines) are hidden from managers/demo.
 */
export function audiencesForRole(role?: string | null): ProjectAudience[] {
    switch (role) {
        case 'admin':
        case 'okk':
        case 'rop':
            return ['all', 'staff'];
        default:
            return ['all'];
    }
}

/**
 * Formats a documentation chunk for semantic search embedding.
 */
export function formatProjectKnowledgeForEmbedding(chunk: {
    title: string;
    content: string;
    subsystem?: string | null;
    heading?: string | null;
    sourcePath?: string | null;
    tags?: string[];
}): string {
    const parts = [
        chunk.subsystem ? `Раздел: ${chunk.subsystem}` : '',
        chunk.heading ? `Заголовок: ${chunk.heading}` : `Заголовок: ${chunk.title}`,
        chunk.tags?.length ? `Теги: ${chunk.tags.join(', ')}` : '',
        chunk.sourcePath ? `Источник: ${chunk.sourcePath}` : '',
        `Содержимое: ${chunk.content}`,
    ].filter(Boolean);

    return parts.join('\n').trim();
}

/**
 * Vector search over project_knowledge, filtered by allowed audiences.
 * Returns [] on any failure (graceful degradation — never breaks the consultant).
 */
export async function searchProjectKnowledge(
    query: string,
    allowedAudiences: ProjectAudience[],
    matchCount: number = 5,
    threshold: number = 0.33,
): Promise<ProjectKnowledgeHit[]> {
    if (!query.trim()) return [];

    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_project_knowledge', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: matchCount,
            allowed_audiences: allowedAudiences,
        });

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.warn('[Project Knowledge] Search failed, continuing without KB hits.', error);
        return [];
    }
}

/**
 * Renders project knowledge hits as numbered context for the LLM prompt.
 */
export function formatProjectKnowledgeContext(hits: ProjectKnowledgeHit[]): string {
    if (hits.length === 0) {
        return 'Подходящие записи в базе знаний проекта не найдены.';
    }

    return hits.map((hit, index) => {
        const where = hit.heading || hit.title;
        const source = hit.source_path ? `Источник: ${hit.source_path}.` : '';
        const similarity = Number.isFinite(hit.similarity) ? `Similarity: ${hit.similarity.toFixed(3)}.` : '';

        return [
            `${index + 1}. ${where}`,
            hit.content,
            source,
            similarity,
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}
