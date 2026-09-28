/**
 * Что оживить этой ночью: список роликов для Kling.
 *
 *   npx tsx scripts/tamara-clip-plan.ts --limit 2
 *
 * Печатает JSON: по каждому ролику — образ, состояние, ссылку на исходный кадр
 * и готовое задание для Kling. Ничего не рисует и кредитов не тратит; только
 * закрепляет образ на ближайшее утро (как это сделал бы крон) и готовит
 * исходный кадр в хранилище.
 *
 * Очередь:
 *   1. покой у образа ближайшего утра — чтобы завтра она была живой в своей
 *      одежде, а не в фирменной;
 *   2. покой у остальных образов — ролик привязан к образу, а не к дате: один
 *      раз оживлённый образ живой при каждом следующем выходе;
 *   3. реакции (приветствие, вывод, комплимент) — сначала у образа утра.
 */
import sharp from 'sharp';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const BUCKET = 'okk-assets';
const ELEMENT = '322314495682213';

/** Цвет подложки — тот же светло-серый, на котором Kling рисует образы. */
const BACKDROP = { r: 233, g: 233, b: 231, alpha: 1 };

const REACTIONS = ['greet', 'explain', 'pleased'] as const;

const TAIL =
    ' Камера неподвижна, один непрерывный план. Фигура целиком в кадре от макушки до ступней, ступни видны всё время, ничего не обрезано. ' +
    'Лицо, одежда и фон — как на исходном кадре, светло-серый однотонный фон. Ролик заканчивается ровно в той же позе, что и начинается.';

const ACTION: Record<string, string> = {
    idle:
        'стоит в полный рост лицом к камере в спокойной позе ожидания: естественно дышит, моргает, у неё нейтральная доброжелательная полуулыбка, ' +
        'взгляд в камеру, руки спокойно опущены вдоль тела, едва заметно переносит вес с одной ноги на другую и обратно. Движения минимальные и плавные.',
    greet:
        'стоит в полный рост лицом к камере и приветствует зрителя: приветливо улыбается, слегка кивает и делает короткий взмах ладонью на уровне груди, ' +
        'затем опускает руку и возвращается в спокойную стойку. Движения естественные, без кокетства.',
    explain:
        'стоит в полный рост лицом к камере и уверенно излагает главный вывод: собранное серьёзное лицо, прямой взгляд; поднимает правую руку и раскрытой ' +
        'ладонью делает короткий жест вперёд «вот главное», слегка кивает, затем опускает руку и возвращается в спокойную стойку.',
    pleased:
        'стоит в полный рост лицом к камере и скромно принимает комплимент: сдержанная тёплая улыбка, на миг опускает глаза и снова смотрит в камеру, ' +
        'коротко прикасается ладонью к груди в жесте «спасибо» и опускает руку, возвращается в ровную стойку. Без кокетства, с достоинством.',
};

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
}

/** Дата утра, к которому готовимся: ночью до полудня по Самаре — сегодня, после — завтра. */
function morningDate(): string {
    const now = new Date();
    const samara = new Date(now.getTime() + 4 * 3600_000);
    if (samara.getUTCHours() >= 12) samara.setUTCDate(samara.getUTCDate() + 1);
    return samara.toISOString().slice(0, 10);
}

(async () => {
    const limit = Number(arg('limit') ?? 2);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(url, key);

    // Образ на утро закрепляется тем же выбором, что у крона: он потом
    // возьмёт уже закреплённый, и ролик совпадёт с одеждой.
    const { chooseOutfit } = await import('../lib/shtab/tamara-wardrobe');
    const date = morningDate();
    const morning = await chooseOutfit(date);

    const { data: wardrobe } = await supabase
        .from('tamara_wardrobe')
        .select('slug, title, image_url')
        .eq('active', true)
        .not('image_url', 'is', null)
        .order('id');
    const { data: clips } = await supabase.from('tamara_clip').select('wardrobe_slug, state').eq('active', true);
    const have = new Set((clips ?? []).map((c: any) => `${c.wardrobe_slug}|${c.state}`));

    const outfits = (wardrobe ?? []) as { slug: string; title: string; image_url: string }[];
    const first = morning?.outfit.slug ?? null;
    const ordered = [...outfits].sort((a, b) => (a.slug === first ? -1 : b.slug === first ? 1 : 0));

    const queue: { slug: string; title: string; image: string; state: string }[] = [];
    const want = (o: (typeof outfits)[number], state: string) => {
        if (!have.has(`${o.slug}|${state}`)) queue.push({ slug: o.slug, title: o.title, image: o.image_url, state });
    };
    // Образ утра получает покой и приветствие первыми: встреча — это первое,
    // что владелец видит, и она должна быть в сегодняшней одежде.
    if (ordered[0]?.slug === first) {
        want(ordered[0], 'idle');
        want(ordered[0], 'greet');
    }
    for (const o of ordered) want(o, 'idle');
    for (const o of ordered) for (const s of REACTIONS) want(o, s);
    // Повторы из-за двух проходов по образу утра.
    const seen = new Set<string>();
    const unique = queue.filter((j) => {
        const k = `${j.slug}|${j.state}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    queue.splice(0, queue.length, ...unique);

    const jobs = [];
    for (const job of queue.slice(0, limit)) {
        jobs.push({
            outfit: job.slug,
            title: job.title,
            state: job.state,
            source: await sourceFrame(supabase, job.slug, job.image),
            prompt: `Женщина <<<${ELEMENT}>>> ${ACTION[job.state]}${TAIL}`,
        });
    }

    console.log(
        JSON.stringify(
            {
                morning: date,
                morning_outfit: morning ? { slug: morning.outfit.slug, title: morning.outfit.title } : null,
                left_after_tonight: Math.max(0, queue.length - jobs.length),
                jobs,
            },
            null,
            2,
        ),
    );
})().catch((e) => {
    console.error('ошибка:', e.message);
    process.exit(1);
});

/**
 * Исходный кадр для ролика: образ из гардероба на светло-сером фоне, 2:3.
 *
 * В гардеробе лежит вырезанная фигура с прозрачным фоном и без полей. Kling
 * прозрачность не понимает, а фигура без полей не оставляет места под взмах
 * руки. Поэтому возвращаем подложку и поля: фигура по центру, 90 % высоты
 * кадра, под ступнями запас.
 */
async function sourceFrame(supabase: any, slug: string, imageUrl: string): Promise<string> {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`кадр образа ${slug} не скачался: ${res.status}`);
    const figure = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(figure).metadata();

    const height = 1764;
    const width = 1176;
    const figH = Math.round(height * 0.9);
    const figW = Math.round(((meta.width ?? 1) / (meta.height ?? 1)) * figH);
    const scaled = await sharp(figure).resize({ height: figH }).png().toBuffer();

    const png = await sharp({ create: { width, height, channels: 4, background: BACKDROP } })
        .composite([{ input: scaled, left: Math.round((width - figW) / 2), top: height - figH - Math.round(height * 0.04) }])
        .flatten({ background: BACKDROP })
        .png()
        .toBuffer();

    const path = `tamara-clip-src/${slug}.png`;
    const up = await supabase.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true });
    if (up.error) throw new Error(`исходный кадр ${slug} не загрузился: ${up.error.message}`);
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
