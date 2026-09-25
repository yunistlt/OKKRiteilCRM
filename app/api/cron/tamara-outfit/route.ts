import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { buildPrompt, drawConfigured, drawOutfit, storeOutfit } from '@/lib/shtab/outfit-draw';
import { chooseOutfit, outfitEnabled } from '@/lib/shtab/tamara-wardrobe';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/cron/tamara-outfit — во что Тамара оденется сегодня.
//
// Ночью, а не при открытии Штаба: отрисовка занимает до минуты, и владелец,
// зашедший утром, не должен смотреть на пустое место, пока рисуется одежда.
//
// Два шага и оба переживают повтор. Сначала выбирается образ — chooseOutfit на
// уже выбранную дату вернёт выбранное, а не переоденет. Потом он рисуется
// заново: задание то же, кадр другой, и утро не повторяется буквально. Если
// отрисовка не удалась, остаётся принятый кадр из гардероба — Тамара выйдет
// одетой в любом случае.
export async function GET(req: NextRequest) {
    const auth = req.headers.get('authorization');
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const force = req.nextUrl.searchParams.get('force') === '1';
    const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    try {
        if (!(await outfitEnabled()) && !force) {
            return NextResponse.json({ ok: true, skipped: 'смена одежды выключена в настройках' });
        }

        const chosen = await chooseOutfit(date, drawConfigured());
        if (!chosen) return NextResponse.json({ ok: true, skipped: 'гардероб пуст' });

        const { data: ref } = await supabase
            .from('shtab_settings')
            .select('value')
            .eq('key', 'outfit_reference_url')
            .maybeSingle();
        const referenceUrl = String((ref as any)?.value ?? '');

        if (!drawConfigured() || !referenceUrl || !chosen.outfit.prompt) {
            const why = !drawConfigured()
                ? 'нет ключей Kling'
                : !referenceUrl
                  ? 'не задан эталонный кадр'
                  : 'у образа нет задания';
            await supabase.from('tamara_outfit_day').update({ draw_error: why }).eq('on_date', date);
            return NextResponse.json({
                ok: true,
                date,
                outfit: chosen.outfit.slug,
                drawn: false,
                reason: chosen.reason,
                note: `${why} — показывается принятый кадр`,
            });
        }

        const prompt = await buildPrompt(chosen.outfit.prompt);
        const drawn = await drawOutfit(prompt, referenceUrl);
        if (!drawn.ok) {
            await supabase.from('tamara_outfit_day').update({ draw_error: drawn.reason }).eq('on_date', date);
            return NextResponse.json({ ok: true, date, outfit: chosen.outfit.slug, drawn: false, note: drawn.reason });
        }

        const url = await storeOutfit(chosen.outfit.slug, date, drawn.png);
        if (!url) {
            await supabase.from('tamara_outfit_day').update({ draw_error: 'кадр не сохранился' }).eq('on_date', date);
            return NextResponse.json({ ok: true, date, drawn: false, note: 'кадр не сохранился' });
        }

        await supabase.from('tamara_outfit_day').update({ image_url: url, draw_error: null }).eq('on_date', date);

        return NextResponse.json({
            ok: true,
            date,
            outfit: chosen.outfit.slug,
            title: chosen.outfit.title,
            drawn: true,
            reason: chosen.reason,
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
    }
}
