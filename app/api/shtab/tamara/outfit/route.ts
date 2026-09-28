import { NextResponse } from 'next/server';
import { chooseOutfit, outfitEnabled, outfitOfDay } from '@/lib/shtab/tamara-wardrobe';
import { liveSet } from '@/lib/shtab/tamara-clips';

export const dynamic = 'force-dynamic';

// GET /api/shtab/tamara/outfit — во что Тамара одета сегодня.
//
// Обычно образ уже выбран ночным кроном, и здесь только чтение. Но если крон
// не отработал (первый день после выкатки, сбой Vercel), выбираем прямо
// сейчас: владелец не должен видеть вчерашнюю одежду из-за того, что где-то не
// сработало расписание.
//
// Рядом с образом едут ролики живой Тамары (live). Их сбой не должен отнимать
// образ: без роликов она просто стоит картинкой, как раньше.
export async function GET() {
    try {
        if (!(await outfitEnabled())) {
            return NextResponse.json({ ok: true, enabled: false, live: await liveSafe(null) });
        }

        const today = new Date().toISOString().slice(0, 10);
        const chosen = (await outfitOfDay(today)) ?? (await chooseOutfit(today));
        const live = await liveSafe(chosen?.outfit.slug ?? null);
        if (!chosen) {
            return NextResponse.json({ ok: true, enabled: true, outfit: null, live });
        }

        return NextResponse.json({
            ok: true,
            enabled: true,
            outfit: {
                slug: chosen.outfit.slug,
                title: chosen.outfit.title,
                imageUrl: chosen.outfit.image_url,
                reason: chosen.reason,
            },
            live,
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
    }
}

async function liveSafe(slug: string | null) {
    try {
        return await liveSet(slug);
    } catch {
        return null;
    }
}
