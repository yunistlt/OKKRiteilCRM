/**
 * Положить принятый образ в гардероб.
 *
 *   npx tsx scripts/tamara-wardrobe-add.ts scratch/look-c-velo.png \
 *       --slug velo-pyatnitsa --title "Велокостюм" \
 *       --season leto --weekday pyatnitsa --temp-min 15
 *
 * Образы сюда попадают только после того, как владелец сказал «да». Автомата
 * приёмки нет и не планируется: одежда — вкусовое дело, и единственный судья
 * здесь человек.
 */
import fs from 'fs';
import { cutout } from './outfit-cutout';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const BUCKET = 'okk-assets';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
}

function num(name: string): number | null {
    const v = arg(name);
    return v === undefined ? null : Number(v);
}

(async () => {
    const file = process.argv[2];
    const slug = arg('slug');
    const title = arg('title');
    if (!file || !slug || !title) {
        console.error('нужны файл, --slug и --title');
        process.exit(1);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }
    const supabase = createClient(url, key);

    // Kling отдаёт кадр на сплошном светлом фоне и с широкими полями. В Штабе
    // фигура стоит на фоне страницы, поэтому фон снимаем, а поля срезаем —
    // иначе Тамара выходит в сером прямоугольнике и вполовину мельче.
    const bytes = await cutout(fs.readFileSync(file));
    const storagePath = `tamara-wardrobe/${slug}.png`;

    const up = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: 'image/png', upsert: true });
    if (up.error) {
        console.error('не загрузилось:', up.error.message);
        process.exit(1);
    }

    // Метка версии в ссылке. Путь у образа постоянный, а CDN держит файл час:
    // без метки перешитая вещь ещё час показывалась бы в прежнем виде.
    const {
        data: { publicUrl: base },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = `${base}?v=${Date.now().toString(36)}`;

    const rain = arg('rain');
    const row = {
        slug,
        title,
        image_url: publicUrl,
        // Задание, по которому вещь сшита. Хранится, чтобы владелец правил
        // формулировку сам и чтобы образ можно было перешить тем же заданием.
        prompt: arg('prompt') ?? '',
        season: arg('season') ?? 'any',
        weekday: arg('weekday') ?? 'any',
        temp_min: num('temp-min'),
        temp_max: num('temp-max'),
        rain: rain === undefined ? null : rain === 'true',
        active: true,
    };

    const { error } = await supabase.from('tamara_wardrobe').upsert(row, { onConflict: 'slug' });
    if (error) {
        console.error('не записалось:', error.message);
        process.exit(1);
    }

    console.log(`${title} (${slug}) в гардеробе`);
    console.log(`  ${publicUrl}`);
    console.log(
        `  сезон ${row.season}, день ${row.weekday}` +
            (row.temp_min !== null ? `, от ${row.temp_min} °C` : '') +
            (row.temp_max !== null ? `, до ${row.temp_max} °C` : '') +
            (row.rain !== null ? `, ${row.rain ? 'только в дождь' : 'только без дождя'}` : ''),
    );
})().catch((e) => {
    console.error('ошибка:', e.message);
    process.exit(1);
});
