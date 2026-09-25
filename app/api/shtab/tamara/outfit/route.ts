import { NextResponse } from 'next/server';
import { chooseOutfit, outfitEnabled, outfitOfDay } from '@/lib/shtab/tamara-wardrobe';

export const dynamic = 'force-dynamic';

// GET /api/shtab/tamara/outfit — во что Тамара одета сегодня.
//
// Обычно образ уже выбран ночным кроном, и здесь только чтение. Но если крон
// не отработал (первый день после выкатки, сбой Vercel), выбираем прямо
// сейчас: владелец не должен видеть вчерашнюю одежду из-за того, что где-то не
// сработало расписание.
export async function GET() {
    try {
        if (!(await outfitEnabled())) {
            return NextResponse.json({ ok: true, enabled: false });
        }

        const today = new Date().toISOString().slice(0, 10);
        const chosen = (await outfitOfDay(today)) ?? (await chooseOutfit(today));
        if (!chosen) {
            return NextResponse.json({ ok: true, enabled: true, outfit: null });
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
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
    }
}
