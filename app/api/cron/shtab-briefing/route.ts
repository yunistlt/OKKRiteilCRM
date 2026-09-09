import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTamaraPrompt, renderTemplate, runTamara, weekStart } from '@/lib/shtab/tamara';
import { executeShtabTool } from '@/lib/shtab/tamara-tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/shtab-briefing — понедельничная сводка Тамары.
//
// Тамара начинает разговор сама: собирает недельный срез, прогоняет через модель
// и кладёт результат в shtab_briefing. При открытии Штаба сводка произносится.
//
// Данные собираются ЗДЕСЬ, в коде, а не моделью через инструменты. Причина:
// сводка должна быть воспроизводима и одинакова всю неделю. Если бы срез
// набирала сама модель, два запуска дали бы разные наборы фактов, и сослаться
// на сводку было бы нельзя.

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

export async function GET(req: NextRequest) {
    try {
        ensureAuthorized(req);
    } catch {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const week = weekStart(new Date());

        const { data: existing, error: existingError } = await supabase
            .from('shtab_briefing')
            .select('week_start')
            .eq('week_start', week)
            .maybeSingle();
        if (existingError) throw new Error(existingError.message);
        if (existing) {
            return NextResponse.json({ ok: true, skipped: 'сводка за эту неделю уже собрана', week });
        }

        // Срез недели: состояние, что закрыто за семь дней, приход.
        const [state, history, income] = await Promise.all([
            executeShtabTool('shtab_state', { include: ['minuses', 'razbory', 'projects'] }),
            executeShtabTool('shtab_history', { days: 7 }),
            executeShtabTool('money_in', { months: 24 }),
        ]);
        const lookedAt = [
            { name: 'shtab_state', args: { include: ['minuses', 'razbory', 'projects'] } },
            { name: 'shtab_history', args: { days: 7 } },
            { name: 'money_in', args: { months: 24 } },
        ];

        const { data: previous } = await supabase
            .from('shtab_briefing')
            .select('week_start, text')
            .order('week_start', { ascending: false })
            .limit(1)
            .maybeSingle();

        const prompt = await getTamaraPrompt('shtab_tamara_briefing');
        const answer = await runTamara({
            prompt,
            purpose: 'shtab_tamara_briefing',
            // Инструменты не нужны: срез уже собран и лежит в сообщении. Иначе
            // модель полезла бы за теми же данными второй раз.
            withTools: false,
            userContent: renderTemplate(prompt.userPromptTemplate, {
                week_data: JSON.stringify({ state, history, income }, null, 1),
                previous_briefing: previous ? `Неделя ${previous.week_start}:\n${previous.text}` : 'Предыдущей сводки нет.',
            }),
        });

        if (!answer.reply.trim()) {
            return NextResponse.json({ ok: false, error: 'Модель вернула пустую сводку' }, { status: 502 });
        }

        const { error: insertError } = await supabase.from('shtab_briefing').insert({
            week_start: week,
            text: answer.reply,
            looked_at: lookedAt,
            model: answer.model,
        });
        if (insertError) throw new Error(insertError.message);

        return NextResponse.json({ ok: true, week, length: answer.reply.length });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
