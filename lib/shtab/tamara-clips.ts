import { supabase } from '@/utils/supabase';

/**
 * Живая Тамара: ролики по состояниям.
 *
 * Ролик нарисован под конкретный образ — одежда в видео впечатана. Если у
 * образа дня своих роликов нет, Тамара выходит в «фирменном» образе для видео
 * (настройка live_clips_outfit): живая фигура в другой одежде лучше, чем
 * неподвижная картинка в сегодняшней.
 *
 * Без ролика покоя набор не годится: покой идёт девяносто процентов времени,
 * остальные ролики из него выходят и в него возвращаются.
 */

export type LiveClip = {
    webmUrl: string;
    hevcUrl: string | null;
    posterUrl: string;
    durationMs: number;
};

export type LiveSet = {
    outfitSlug: string;
    outfitTitle: string;
    clips: Record<string, LiveClip>;
};

async function setting(key: string): Promise<string | null> {
    const { data } = await supabase.from('shtab_settings').select('value').eq('key', key).maybeSingle();
    return (data as any)?.value ?? null;
}

async function clipsOf(slug: string): Promise<Record<string, LiveClip> | null> {
    const { data, error } = await supabase
        .from('tamara_clip')
        .select('state, webm_url, hevc_url, poster_url, duration_ms')
        .eq('wardrobe_slug', slug)
        .eq('active', true);
    if (error || !data?.length) return null;

    const clips: Record<string, LiveClip> = {};
    for (const row of data as any[]) {
        clips[row.state] = {
            webmUrl: row.webm_url,
            hevcUrl: row.hevc_url,
            posterUrl: row.poster_url,
            durationMs: row.duration_ms,
        };
    }
    return clips.idle ? clips : null;
}

/** Набор роликов на сегодня: свой у образа дня, иначе фирменный. Выключено — null. */
export async function liveSet(todaySlug: string | null): Promise<LiveSet | null> {
    if ((await setting('live_clips_enabled')) !== 'true') return null;

    const candidates = [todaySlug, await setting('live_clips_outfit')].filter(Boolean) as string[];
    for (const slug of candidates) {
        const clips = await clipsOf(slug);
        if (!clips) continue;
        const { data } = await supabase.from('tamara_wardrobe').select('title').eq('slug', slug).maybeSingle();
        return { outfitSlug: slug, outfitTitle: String((data as any)?.title ?? ''), clips };
    }
    return null;
}
