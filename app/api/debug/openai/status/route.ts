
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

export async function GET() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        return NextResponse.json({
            status: 'error',
            message: 'Ключ OPENAI_API_KEY не найден в переменных окружения'
        });
    }

    try {
        const openai = new OpenAI({ apiKey });

        // Simple test: list models
        // This is cheaper/faster than a completion
        const models = await openai.models.list();

        return NextResponse.json({
            status: 'ok',
            message: 'API Key is valid and active',
            details: `Found ${models.data.length} models available.`
        });
    } catch (error: any) {
        console.error('[OpenAI Status Check] Failed:', error);

        let message = 'Ошибка при подключении к OpenAI';
        if (error.status === 401) {
            message = 'Неверный API ключ (401 Unauthorized)';
        } else if (error.status === 429) {
            message = 'Лимит запросов исчерпан или недостаточно средств на балансе (429 Too Many Requests)';
        }

        return NextResponse.json({
            status: 'error',
            message: message,
            code: error.code || error.status || 'unknown'
        });
    }
}
