import OpenAI from 'openai';

let _openai: OpenAI | null = null;

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
