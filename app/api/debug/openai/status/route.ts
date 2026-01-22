
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

        // List models to verify key and get available models
        const list = await openai.models.list();
        const models = list.data.map(m => m.id);

        // Check for required models
        const hasGpt4oMini = models.some(m => m.includes('gpt-4o-mini'));
        const hasWhisper = models.some(m => m.includes('whisper'));

        return NextResponse.json({
            status: 'ok',
            message: 'API Key активен',
            key_preview: `...${apiKey.slice(-4)}`,
            models: {
                total: models.length,
                has_gpt4o_mini: hasGpt4oMini,
                has_whisper: hasWhisper
            },
            billing_url: 'https://platform.openai.com/settings/organization/billing/overview'
        });
    } catch (error: any) {
        console.error('[OpenAI Status Check] Failed:', error);

        let message = 'Ошибка при подключении к OpenAI';
        let reason = 'network_error';

        if (error.status === 401) {
            message = 'Неверный API ключ (401 Unauthorized)';
            reason = 'invalid_key';
        } else if (error.status === 429) {
            message = 'Лимит запросов исчерпан или недостаточно средств (429 Too Many Requests)';
            reason = 'insufficient_quota';
        }

        return NextResponse.json({
            status: 'error',
            message: message,
            reason: reason,
            code: error.code || error.status || 'unknown',
            billing_url: 'https://platform.openai.com/settings/organization/billing/overview'
        });
    }
}
