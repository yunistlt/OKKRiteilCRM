import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTamaraPrompt, runTamara } from '@/lib/shtab/tamara';
import { outfitOfDay } from '@/lib/shtab/tamara-wardrobe';

export const dynamic = 'force-dynamic';

// GET /api/shtab/tamara/greeting — как Тамара здоровается сегодня.
//
// Сочиняется один раз в день и сохраняется. Если сочинять каждый раз, при
// втором заходе она поздоровается заново и расскажет другой анекдот — а это уже
// не встреча, а лента. Человек, с которым виделись утром, днём здоровается
// иначе; здесь проще: днём не здоровается вовсе.
//
// Инструменты отключены намеренно. Приветствие не должно ходить в базу: это
// две секунды ожидания на первом экране и лишний повод рассказать за завтраком
// про просроченные заказы. Для дел есть отчёт.

const TASK = `Поздоровайся с владельцем — это первый его заход в разговор сегодня.

Три части, коротко, всего пять–семь строк.
— Живое приветствие. Не «Здравствуйте», а как здороваются с человеком, которого знаешь не первый год.
— Короткая история или анекдот. Что-то одно. Лучше про работу, заводы, продажи, клиентов — но не обязательно. Заканчивай так, чтобы было смешно или любопытно, а не «мораль сей басни».
— Вопрос о нём. Что нового, как выходные, как спалось — живой вопрос, не анкета.

Чего не делай.
— Не пересказывай дела компании и не называй цифры: для этого есть утренний отчёт.
— Не спрашивай «чем могу помочь» и не предлагай услуги.
— Не повторяй вчерашнее приветствие, если оно показано ниже.`;

export async function GET() {
    const today = new Date().toISOString().slice(0, 10);

    try {
        const { data: enabled } = await supabase
            .from('shtab_settings')
            .select('value')
            .eq('key', 'greeting_enabled')
            .maybeSingle();
        if (String((enabled as any)?.value ?? 'true') !== 'true') {
            return NextResponse.json({ ok: true, greeting: null });
        }

        const { data: kept } = await supabase
            .from('tamara_greeting')
            .select('text')
            .eq('on_date', today)
            .maybeSingle();
        if (kept) {
            return NextResponse.json({ ok: true, greeting: String((kept as any).text), fresh: false });
        }

        const { data: past } = await supabase
            .from('tamara_greeting')
            .select('text')
            .order('on_date', { ascending: false })
            .limit(3);

        // Во что она сегодня одета — повод для живой фразы: человек, пришедший
        // в велокостюме, обычно это как-то поясняет.
        const outfit = await outfitOfDay(today);

        const prompt = await getTamaraPrompt('shtab_tamara_chat');
        const answer = await runTamara({
            prompt,
            purpose: 'greeting',
            withTools: false,
            reasoningEffort: 'low',
            userContent:
                `${TASK}\n\nСегодня ${today}.` +
                (outfit ? `\nТы сегодня одета так: ${outfit.outfit.title}.` : '') +
                ((past ?? []).length
                    ? `\n\nПрошлые приветствия, не повторяйся:\n${(past as any[])
                          .map((p) => `— ${String(p.text).slice(0, 300)}`)
                          .join('\n')}`
                    : ''),
        });

        const text = String(answer.reply ?? '').trim();
        if (!text) return NextResponse.json({ ok: true, greeting: null });

        // Гонка возможна: две вкладки открылись разом. Побеждает первая
        // записавшая, вторая берёт её текст — иначе владелец увидит два разных
        // приветствия за одно утро.
        await supabase.from('tamara_greeting').upsert({ on_date: today, text }, { onConflict: 'on_date' });
        const { data: settled } = await supabase
            .from('tamara_greeting')
            .select('text')
            .eq('on_date', today)
            .maybeSingle();

        return NextResponse.json({ ok: true, greeting: String((settled as any)?.text ?? text), fresh: true });
    } catch (e: any) {
        // Не поздоровалась — не повод не пустить в разговор.
        return NextResponse.json({ ok: true, greeting: null, error: String(e?.message ?? e) });
    }
}
