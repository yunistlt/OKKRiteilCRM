/**
 * Положить ролик живой Тамары: снять фон, собрать прозрачное видео, загрузить.
 *
 *   FFMPEG=/путь/к/ffmpeg npx tsx scripts/tamara-clip-add.ts scratch/clips/idle.mp4 \
 *       --outfit terrakota-zhaket-sigarety --state idle --prompt "что делает"
 *
 * Kling отдаёт ролик на сплошном светлом фоне, а в Штабе фигура стоит на фоне
 * страницы — без выреза Тамара ходила бы в сером прямоугольнике. Фон снимается
 * покадрово тем же вырезом, что и у гардероба.
 *
 * Прозрачное видео браузеры понимают по-разному, поэтому форматов два:
 * WebM (VP9 с альфой) — Chrome, Firefox, Edge; HEVC с альфой — Safari. HEVC с
 * альфой кодирует только аппаратный кодер Apple, так что скрипт гоняется на
 * маке. Не собрался HEVC — Safari покажет картинку образа, как раньше.
 *
 * ffmpeg в зависимости проекта не входит (на Vercel он не нужен): путь к нему
 * задаётся переменной FFMPEG, по умолчанию берётся из PATH.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { cutoutKeepFrame } from './outfit-cutout';

dotenv.config({ path: '.env.local' });

const BUCKET = 'okk-assets';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 24;

/** Высота готового ролика. На экране фигура не выше ~900 px, с запасом на ретину. */
const OUT_HEIGHT = 1280;

/** Состояния, под которые бывают ролики. Коды — как у фигуры в app/shtab/Tamara.tsx. */
const STATES = ['idle', 'greet', 'explain', 'pleased'] as const;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
}

/** Границы непрозрачного в вырезанном кадре. */
async function figureBox(file: string) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    let left = info.width;
    let top = info.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
            if (data[(y * info.width + x) * info.channels + 3] > 8) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    return { left, top, right, bottom };
}

function ffmpeg(args: string[]) {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

(async () => {
    const file = process.argv[2];
    const outfit = arg('outfit');
    const state = arg('state');
    if (!file || !outfit || !state) {
        console.error('нужны файл, --outfit и --state');
        process.exit(1);
    }
    if (!(STATES as readonly string[]).includes(state)) {
        console.error(`неизвестное состояние «${state}», есть: ${STATES.join(', ')}`);
        process.exit(1);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }
    const supabase = createClient(url, key);

    const work = fs.mkdtempSync(path.join(os.tmpdir(), `tamara-clip-${state}-`));
    const rawDir = path.join(work, 'raw');
    const cutDir = path.join(work, 'cut');
    fs.mkdirSync(rawDir);
    fs.mkdirSync(cutDir);

    // 1. Кадры.
    ffmpeg(['-i', file, '-vf', `fps=${FPS}`, path.join(rawDir, '%04d.png')]);
    const frames = fs.readdirSync(rawDir).filter((f) => f.endsWith('.png')).sort();
    if (!frames.length) throw new Error('ffmpeg не выдал ни одного кадра');

    // 2. Фон с каждого кадра и общая рамка фигуры по всем кадрам.
    let left = Infinity;
    let top = Infinity;
    let right = -1;
    let bottom = -1;
    let width = 0;
    let height = 0;
    for (const f of frames) {
        const cut = await cutoutKeepFrame(fs.readFileSync(path.join(rawDir, f)), { holes: true });
        fs.writeFileSync(path.join(cutDir, f), cut);
        const { data, info } = await sharp(cut).raw().toBuffer({ resolveWithObject: true });
        width = info.width;
        height = info.height;
        for (let y = 0; y < info.height; y += 1) {
            for (let x = 0; x < info.width; x += 1) {
                if (data[(y * info.width + x) * info.channels + 3] > 8) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
            }
        }
    }
    if (right < 0) throw new Error('фигура не найдена ни в одном кадре');

    // Упирается фигура в нижний край — у неё срезаны ступни, такой ролик
    // класть нельзя: на экране Тамара стояла бы без ног.
    if (bottom >= height - 2) {
        console.error('фигура упирается в нижний край кадра — срезаны ступни, ролик не кладу');
        process.exit(1);
    }

    // Рамка обрезки у всех роликов одного образа обязана быть одной и той же:
    // плеер переключает ролики на лету, и при разной рамке Тамара на стыке
    // прыгала бы в размере и в сторону. Поэтому рамка задаётся снаружи
    // (--frame, считается по всем роликам образа), а своя рамка ролика только
    // печатается — по ней общую и считают.
    console.log(`фигура в кадре: ${left}:${top}:${right}:${bottom} из ${width}×${height}`);
    const frame = arg('frame');
    if (frame === 'auto') {
        // Рамка от первого кадра, а не от всего ролика: все ролики образа
        // начинаются с одного и того же исходного кадра, значит и рамка у них
        // выйдет одна. По ширине — запас под взмах руки, симметрично вокруг
        // фигуры (как у фирменного образа: полширины ≈ 0,27 высоты фигуры).
        const f = await figureBox(path.join(cutDir, frames[0]));
        const figH = f.bottom - f.top;
        const cx = Math.round((f.left + f.right) / 2);
        const half = Math.max(Math.round((f.right - f.left) / 2), Math.round(figH * 0.27));
        left = Math.max(0, cx - half);
        right = Math.min(width - 1, cx + half);
        top = Math.max(0, f.top - Math.round(figH * 0.02));
        bottom = Math.min(height - 1, f.bottom + Math.round(figH * 0.01));
        console.log(`общая рамка: ${left}:${top}:${right}:${bottom}`);
    } else if (frame) {
        [left, top, right, bottom] = frame.split(':').map(Number);
    } else {
        console.warn('без --frame рамка своя — годится для пробы, но не для набора роликов');
    }

    // Небольшой запас по краям, чётные размеры — их требуют оба кодека.
    const pad = 6;
    left = Math.max(0, left - pad);
    top = Math.max(0, top - pad);
    right = Math.min(width - 1, right + pad);
    bottom = Math.min(height - 1, bottom + pad);
    const cropW = (right - left + 1) & ~1;
    const cropH = (bottom - top + 1) & ~1;
    const scale = `scale=-2:${Math.min(OUT_HEIGHT, cropH)}`;
    const vf = `crop=${cropW}:${cropH}:${left}:${top},${scale}`;
    const pattern = path.join(cutDir, '%04d.png');

    // 3. Два формата и обложка.
    const webm = path.join(work, 'clip.webm');
    ffmpeg([
        '-framerate', String(FPS), '-i', pattern, '-vf', vf,
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30',
        '-row-mt', '1', '-auto-alt-ref', '0', '-an', webm,
    ]);

    const hevc = path.join(work, 'clip.mov');
    let hevcOk = true;
    try {
        ffmpeg([
            '-framerate', String(FPS), '-i', pattern, '-vf', `${vf},format=bgra`,
            '-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.75', '-b:v', '6M',
            '-tag:v', 'hvc1', '-an', hevc,
        ]);
    } catch {
        hevcOk = false;
        console.warn('HEVC с прозрачностью не собрался — в Safari будет картинка образа');
    }

    const poster = path.join(work, 'poster.webp');
    ffmpeg(['-i', path.join(cutDir, frames[0]), '-vf', vf, '-c:v', 'libwebp', '-lossless', '0', '-q:v', '82', poster]);

    // Проба без загрузки: файлы кладутся рядом с исходником, чтобы посмотреть
    // вырез глазами до того, как ролик попадёт на экран владельцу.
    if (process.argv.includes('--dry')) {
        const base = file.replace(/\.[^.]+$/, '');
        fs.copyFileSync(webm, `${base}.cut.webm`);
        if (hevcOk) fs.copyFileSync(hevc, `${base}.cut.mov`);
        fs.copyFileSync(poster, `${base}.cut.webp`);
        console.log(`проба: ${base}.cut.* (${frames.length} кадров, ${cropW}×${cropH})`);
        fs.rmSync(work, { recursive: true, force: true });
        return;
    }

    // 4. В хранилище. Метка версии в ссылке — CDN держит файл час, а путь у
    // ролика постоянный: без метки перерисованный ролик час показывался бы старым.
    const version = Date.now().toString(36);
    const put = async (local: string, name: string, contentType: string) => {
        const storagePath = `tamara-clips/${outfit}/${state}.${name}`;
        const up = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, fs.readFileSync(local), { contentType, upsert: true });
        if (up.error) throw new Error(`не загрузилось ${storagePath}: ${up.error.message}`);
        const {
            data: { publicUrl },
        } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
        return `${publicUrl}?v=${version}`;
    };

    const webmUrl = await put(webm, 'webm', 'video/webm');
    const hevcUrl = hevcOk ? await put(hevc, 'mov', 'video/quicktime') : null;
    const posterUrl = await put(poster, 'webp', 'image/webp');

    const row = {
        wardrobe_slug: outfit,
        state,
        webm_url: webmUrl,
        hevc_url: hevcUrl,
        poster_url: posterUrl,
        duration_ms: Math.round((frames.length / FPS) * 1000),
        prompt: arg('prompt') ?? '',
        active: true,
    };
    const { error } = await supabase.from('tamara_clip').upsert(row, { onConflict: 'wardrobe_slug,state' });
    if (error) {
        console.error('не записалось:', error.message);
        process.exit(1);
    }

    const kb = (p: string) => `${Math.round(fs.statSync(p).size / 1024)} КБ`;
    console.log(`ролик ${state} для ${outfit}: ${frames.length} кадров, ${cropW}×${cropH}`);
    console.log(`  webm ${kb(webm)}${hevcOk ? `, hevc ${kb(hevc)}` : ''}`);
    console.log(`  ${webmUrl}`);
    fs.rmSync(work, { recursive: true, force: true });
})().catch((e) => {
    console.error('ошибка:', e.message);
    process.exit(1);
});
