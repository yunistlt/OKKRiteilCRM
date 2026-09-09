import { OpenAI } from 'openai';

let openaiClient: OpenAI | null = null;

export function isOpenAIConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Базовый URL для запросов к OpenAI.
 * По умолчанию — прямой api.openai.com. Если задан OPENAI_BASE_URL, все вызовы
 * (чат, эмбеддинги, whisper) идут через него — наш транзитный прокси в Амстердаме
 * (`api-gate.okk24.online`), чтобы не упираться в региональную блокировку.
 */
export function getOpenAIBaseUrl(): string | undefined {
    return process.env.OPENAI_BASE_URL?.trim() || undefined;
}

/**
 * Шлюз пускает по IP-allowlist либо по секретному заголовку. У Vercel постоянного
 * исходящего IP нет, поэтому шлём секрет заголовком.
 */
export function getOpenAIGateHeaders(): Record<string, string> | undefined {
    const secret = process.env.OPENAI_GATE_SECRET?.trim();
    return secret ? { 'X-Gate-Secret': secret } : undefined;
}

export function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        if (!isOpenAIConfigured()) {
            throw new Error('OPENAI_API_KEY is not defined in environment variables');
        }
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: getOpenAIBaseUrl(),
            defaultHeaders: getOpenAIGateHeaders(),
        });
    }
    return openaiClient;
}
