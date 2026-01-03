import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';

export async function GET() {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({
                status: 'error',
                message: 'API Key missing in environment'
            });
        }

        const openai = new OpenAI({ apiKey });

        try {
            // Test with a tiny model/prompt
            await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: "hi" }],
                max_tokens: 1
            });

            return NextResponse.json({
                status: 'ok',
                message: 'API Key is valid and active',
                model: 'gpt-4o-mini'
            });
        } catch (openaiError: any) {
            console.error('[OpenAI Status] Test failed:', openaiError);

            let message = openaiError.message;
            if (openaiError.code === 'insufficient_quota') {
                message = '❌ Баланс исчерпан! Пожалуйста, пополните счет в кабинете OpenAI.';
            } else if (openaiError.status === 401) {
                message = '❌ Неверный API Key. Проверьте настройки .env.local';
            }

            return NextResponse.json({
                status: 'error',
                code: openaiError.code,
                message: message
            });
        }

    } catch (e: any) {
        return NextResponse.json({ status: 'error', message: e.message }, { status: 500 });
    }
}
