import { OpenAI } from 'openai';

let openaiClient: OpenAI | null = null;

export function isOpenAIConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        if (!isOpenAIConfigured()) {
            throw new Error('OPENAI_API_KEY is not defined in environment variables');
        }
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return openaiClient;
}
