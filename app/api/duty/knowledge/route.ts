import { NextRequest, NextResponse } from 'next/server';
import { checkDutyToken, dutyTokenConfigured } from '@/lib/shtab/duty-auth';
import { searchTamaraKnowledge } from '@/lib/shtab/tamara';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/duty/knowledge?q=... — выдержки из базы знаний под вопрос исполнителя.
//
// Консультант ЦехУспеха отвечает своим голосом, а материал берёт отсюда. Отдаём
// текст и источник: он обязан называть, откуда мысль, как и Тамара.
//
// Фактов о компании здесь нет и быть не может — это база знаний по ремеслу и
// методичке. Задачи человека берутся отдельным запросом, /api/duty/tasks.

export async function GET(req: NextRequest) {
    if (!dutyTokenConfigured()) {
        return NextResponse.json({ error: 'Служебный доступ не настроен: нет SHTAB_DUTY_TOKEN' }, { status: 503 });
    }
    if (!checkDutyToken(req.headers.get('authorization'))) {
        return NextResponse.json({ error: 'Неверный токен' }, { status: 401 });
    }

    try {
        const q = (req.nextUrl.searchParams.get('q') || '').trim();
        if (!q) return NextResponse.json({ error: 'Не передан вопрос q' }, { status: 400 });

        const hits = await searchTamaraKnowledge(q);
        return NextResponse.json({
            found: hits.length,
            articles: hits.map((h) => ({
                title: h.title,
                content: h.content,
                source: h.source_ref,
                similarity: Math.round(h.similarity * 100) / 100,
            })),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
