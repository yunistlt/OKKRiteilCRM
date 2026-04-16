import OpenAI from 'openai';

let _openai: OpenAI | null = null;
const EMBEDDING_DIMENSIONS = 1536;

function hashString(value: string, seed: number): number {
    let hash = 2166136261 ^ seed;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function normalizeVector(values: number[]): number[] {
    const norm = Math.sqrt(values.reduce((sum, current) => sum + current * current, 0));
    if (!norm) return values;
    return values.map((value) => value / norm);
}

function generateLocalEmbedding(text: string): number[] {
    const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
    const normalized = text.toLowerCase();
    const tokens = normalized.match(/[\p{L}\p{N}_-]+/gu) || normalized.split(/\s+/).filter(Boolean);
    const features = new Set<string>();

    for (const token of tokens) {
        features.add(`tok:${token}`);

        if (token.length >= 3) {
            for (let index = 0; index <= token.length - 3; index += 1) {
                features.add(`tri:${token.slice(index, index + 3)}`);
            }
        }
    }

    if (features.size === 0) {
        features.add(`raw:${normalized.trim() || 'empty'}`);
    }

    for (const feature of features) {
        const primary = hashString(feature, 0) % EMBEDDING_DIMENSIONS;
        const secondary = hashString(feature, 1) % EMBEDDING_DIMENSIONS;
        const tertiary = hashString(feature, 2) % EMBEDDING_DIMENSIONS;
        const direction = (hashString(feature, 3) & 1) === 0 ? 1 : -1;
        const weight = feature.startsWith('tok:') ? 1.25 : 0.5;

        vector[primary] += 1.0 * direction * weight;
        vector[secondary] += 0.5 * direction * weight;
        vector[tertiary] -= 0.25 * direction * weight;
    }

    return normalizeVector(vector);
}

function getOpenAI() {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not set');
        }
        _openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return _openai;
}

/**
 * Generates an embedding for a given text using OpenAI.
 * Uses text-embedding-3-small by default (1536 dimensions).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    if (!text) return [];

    if (!process.env.OPENAI_API_KEY) {
        return generateLocalEmbedding(text.replace(/\n/g, ' '));
    }

    try {
        const openai = getOpenAI();
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text.replace(/\n/g, ' '), // Good practice to replace newlines
        });

        return response.data[0].embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
}

/**
 * Formats order context and reasoning into a single string for embedding.
 * This ensures the semantic search picks up relevant business details.
 */
export function formatExampleForEmbedding(reasoning: string, context: any): string {
    const status = context.target_status || context.status || 'unknown';
    const number = context.order_number || context.number || 'unknown';
    const comments = context.comments?.manager || context.comments || '';
    
    return `Order #${number} [Target: ${status}]
Reasoning: ${reasoning}
Context: ${comments}`.trim();
}

/**
 * Formats product knowledge for embedding to allow semantic search by name, category, or features.
 */
export function formatProductForEmbedding(pk: {
    name: string;
    category?: string;
    description?: string;
    use_cases?: string[];
    solved_tasks?: string[];
    pain_points?: string[];
}): string {
    const parts = [
        `Product: ${pk.name}`,
        pk.category ? `Category: ${pk.category}` : '',
        pk.description ? `Description: ${pk.description}` : '',
        pk.use_cases?.length ? `Use Cases: ${pk.use_cases.join(', ')}` : '',
        pk.solved_tasks?.length ? `Benefits: ${pk.solved_tasks.join(', ')}` : '',
        pk.pain_points?.length ? `Pain Points: ${pk.pain_points.join(', ')}` : ''
    ].filter(Boolean);

    return parts.join('\n').trim();
}

/**
 * Formats a generic prompt/block for embedding.
 */
export function formatPromptForEmbedding(p: {
    key?: string;
    name?: string;
    description?: string;
    content?: string;
}): string {
    const parts = [
        p.name || p.key ? `Title: ${p.name || p.key}` : '',
        p.description ? `Description: ${p.description}` : '',
        p.content ? `Content: ${p.content}` : ''
    ].filter(Boolean);

    return parts.join('\n').trim();
}

/**
 * Formats consultant knowledge entries for semantic search.
 */
export function formatConsultantKnowledgeForEmbedding(entry: {
    type: string;
    title: string;
    content: string;
    sectionKey?: string | null;
    tags?: string[];
    sourceRef?: string | null;
}): string {
    const parts = [
        `Type: ${entry.type}`,
        entry.sectionKey ? `Section: ${entry.sectionKey}` : '',
        `Title: ${entry.title}`,
        entry.tags?.length ? `Tags: ${entry.tags.join(', ')}` : '',
        entry.sourceRef ? `Source: ${entry.sourceRef}` : '',
        `Content: ${entry.content}`,
    ].filter(Boolean);

    return parts.join('\n').trim();
}
