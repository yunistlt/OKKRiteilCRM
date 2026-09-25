/**
 * У кого из гардероба срезаны ноги.
 *
 * Признак простой: фигура доходит до самой нижней строки кадра. Стоящий человек
 * в полный рост так не снимается — под стопами всегда есть просвет. Значит,
 * кадр обрезал ноги, а не модель так нарисовала.
 */
import dotenv from 'dotenv';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

(async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await supabase.from('tamara_wardrobe').select('slug, image_url').not('image_url', 'is', null);

    for (const row of (data ?? []) as any[]) {
        const res = await fetch(row.image_url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());

        const { data: px, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels: c } = info;

        // Насколько широка фигура в самой нижней строке. Пара стоп — это
        // проценты ширины кадра; голени, срезанные рамкой, заметно шире.
        let bottom = 0;
        for (let x = 0; x < w; x += 1) if (px[((h - 1) * w + x) * c + 3] > 128) bottom += 1;

        const share = Math.round((100 * bottom) / w);
        console.log(`${share > 6 ? 'СРЕЗАНЫ' : 'целы   '} ${row.slug} — нижняя строка занята на ${share}%`);
    }
})().catch((e) => {
    console.error('ошибка:', e.message);
    process.exit(1);
});
