import { supabase } from '@/utils/supabase';
import { generateEmbedding } from './embeddings';

export interface KBMatch {
    id?: string;
    similarity: number;
    [key: string]: any;
}

/**
 * Searches for similar products in the knowledge base.
 */
export async function searchProductKnowledge(query: string, matchCount: number = 3, threshold: number = 0.5): Promise<KBMatch[]> {
    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_product_knowledge', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: matchCount
        });

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('KB Product Search Error:', e);
        return [];
    }
}

/**
 * Searches for similar prompts in system_prompts or ai_prompts.
 */
export async function searchPrompts(query: string, table: 'system_prompts' | 'ai_prompts', matchCount: number = 3, threshold: number = 0.5): Promise<KBMatch[]> {
    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_prompts', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: matchCount,
            prompt_table: table
        });

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error(`KB Prompt Search Error (${table}):`, e);
        return [];
    }
}

/**
 * Searches for similar OKK block definitions.
 */
export async function searchOKKBlocks(query: string, matchCount: number = 3, threshold: number = 0.5): Promise<KBMatch[]> {
    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_okk_blocks', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: matchCount
        });

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('KB OKK Blocks Search Error:', e);
        return [];
    }
}

/**
 * Searches for similar knowledge entries for the OKK consultant.
 */
export async function searchConsultantKnowledge(query: string, sectionKey?: string | null, matchCount: number = 4, threshold: number = 0.58): Promise<KBMatch[]> {
    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_okk_consultant_knowledge', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: matchCount,
            requested_section_key: sectionKey || null,
        });

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('KB Consultant Search Error:', e);
        return [];
    }
}
