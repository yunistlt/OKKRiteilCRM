/**
 * Что уже висит в гардеробе.
 *
 *   npx tsx scripts/tamara-wardrobe-list.ts
 *
 * Нужен перед ночным пополнением: гардероб набивается по дюжине образов за
 * ночь, и единственный способ не сшить второй раз то же самое — посмотреть, что
 * уже сшито. Печатает коротко, одной строкой на образ, чтобы список целиком
 * помещался перед глазами.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

(async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase
        .from('tamara_wardrobe')
        .select('slug, title, season, weekday, image_url')
        .order('id');
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const drawn = rows.filter((r: any) => r.image_url).length;
    console.log(`в гардеробе ${rows.length}, с кадром ${drawn}, ждут отрисовки ${rows.length - drawn}\n`);
    for (const r of rows as any[]) {
        console.log(`${r.image_url ? '+' : '·'} ${r.slug} — ${r.title} [${r.season}/${r.weekday}]`);
    }
})().catch((e) => {
    console.error('ошибка:', e.message);
    process.exit(1);
});
