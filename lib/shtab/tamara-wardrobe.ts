import { supabase } from '@/utils/supabase';

/**
 * Во что Тамара одета сегодня.
 *
 * Правило выбора одно и держится на двух опорах: образ должен подходить дню
 * (сезон, день недели, погода) и не должен повторяться. Вторая опора важнее,
 * чем кажется: гардероб из тридцати вещей при случайном выборе даёт повтор уже
 * на шестой день — день сурка вместо «каждый день новая».
 *
 * Поэтому выбираем не случайно, а по давности: из подходящих берётся тот, что
 * не надевался дольше всех. Ни разу не надёванный идёт первым — новое в
 * гардеробе показывается сразу, а не ждёт своей очереди месяц.
 */

export type Wardrobe = {
    id: number;
    slug: string;
    title: string;
    /** Принятый кадр. Пусто — образ существует только заданием и ждёт отрисовки. */
    image_url: string | null;
    /** Задание на отрисовку — одежда этого образа, без общей части. */
    prompt: string;
    season: string;
    weekday: string;
    temp_min: number | null;
    temp_max: number | null;
    rain: boolean | null;
};

export type DayContext = {
    /** Дата в виде YYYY-MM-DD. */
    date: string;
    season: 'zima' | 'vesna' | 'leto' | 'osen';
    weekday: 'budni' | 'pyatnitsa' | 'vyhodnoy';
    /** Температура и дождь — если погоду узнать не вышло, здесь null. */
    tempC: number | null;
    rain: boolean | null;
};

/** Завод и владелец в Тольятти; погода нужна тамошняя. */
const LAT = 53.51;
const LON = 49.42;

export function seasonOf(d: Date): DayContext['season'] {
    const m = d.getMonth() + 1;
    if (m === 12 || m <= 2) return 'zima';
    if (m <= 5) return 'vesna';
    if (m <= 8) return 'leto';
    return 'osen';
}

export function weekdayOf(d: Date): DayContext['weekday'] {
    const w = d.getDay();
    if (w === 0 || w === 6) return 'vyhodnoy';
    return w === 5 ? 'pyatnitsa' : 'budni';
}

/**
 * Погода на день.
 *
 * Open-Meteo выбран потому, что не требует ключа: ещё один секрет на проде
 * ради одной картинки — плохой обмен. Недоступность прогноза не должна ронять
 * выбор образа, поэтому при любой беде возвращаем «погода неизвестна», и
 * дальше решают сезон с днём недели.
 */
export async function fetchWeather(date: string): Promise<{ tempC: number | null; rain: boolean | null }> {
    try {
        const url =
            `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
            `&daily=temperature_2m_max,precipitation_sum&timezone=Europe%2FSamara&start_date=${date}&end_date=${date}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return { tempC: null, rain: null };
        const json: any = await res.json();
        const temp = json?.daily?.temperature_2m_max?.[0];
        const precip = json?.daily?.precipitation_sum?.[0];
        return {
            tempC: typeof temp === 'number' ? Math.round(temp) : null,
            rain: typeof precip === 'number' ? precip >= 1 : null,
        };
    } catch {
        return { tempC: null, rain: null };
    }
}

export async function dayContext(date: string): Promise<DayContext> {
    const d = new Date(`${date}T12:00:00`);
    const weather = await fetchWeather(date);
    return { date, season: seasonOf(d), weekday: weekdayOf(d), ...weather };
}

/**
 * Подходит ли образ дню.
 *
 * Условие, оставленное пустым, означает «всё равно», а не «никогда»: гардероб
 * заполняется постепенно, и образ без проставленных границ должен работать, а
 * не выпадать из обращения. Неизвестная погода тоже не запрещает ничего —
 * иначе сбой прогноза раздел бы Тамару.
 */
export function suits(w: Wardrobe, ctx: DayContext): boolean {
    if (w.season !== 'any' && w.season !== ctx.season) return false;
    if (w.weekday !== 'any' && w.weekday !== ctx.weekday) return false;
    if (ctx.tempC !== null) {
        if (w.temp_min !== null && ctx.tempC < w.temp_min) return false;
        if (w.temp_max !== null && ctx.tempC > w.temp_max) return false;
    }
    if (w.rain !== null && ctx.rain !== null && w.rain !== ctx.rain) return false;
    return true;
}

export function describeContext(ctx: DayContext): string {
    const season = { zima: 'зима', vesna: 'весна', leto: 'лето', osen: 'осень' }[ctx.season];
    const weekday = { budni: 'будни', pyatnitsa: 'пятница', vyhodnoy: 'выходной' }[ctx.weekday];
    const weather =
        ctx.tempC === null ? 'погода неизвестна' : `${ctx.tempC} °C${ctx.rain ? ', дождь' : ''}`;
    return `${season}, ${weekday}, ${weather}`;
}

/**
 * Выбрать образ на дату и закрепить его.
 *
 * Возвращает уже выбранный, если он есть: повторный запуск крона не должен
 * переодевать Тамару в середине дня.
 */
export async function chooseOutfit(
    date: string,
    /** Есть ли чем нарисовать. Без этого образы без принятого кадра не берутся. */
    canDraw = false,
): Promise<{ outfit: Wardrobe; reason: string } | null> {
    const { data: already } = await supabase
        .from('tamara_outfit_day')
        .select('wardrobe_id, reason')
        .eq('on_date', date)
        .maybeSingle();

    const { data: rows } = await supabase.from('tamara_wardrobe').select('*').eq('active', true);
    let wardrobe = (rows ?? []) as Wardrobe[];

    // Образ без принятого кадра годится только тогда, когда его есть чем
    // нарисовать. Иначе Тамара вышла бы невидимкой.
    if (!canDraw) wardrobe = wardrobe.filter((w) => Boolean(w.image_url));
    if (!wardrobe.length) return null;

    if (already) {
        const kept = wardrobe.find((w) => w.id === (already as any).wardrobe_id);
        if (kept) return { outfit: kept, reason: String((already as any).reason ?? '') };
    }

    const ctx = await dayContext(date);
    // Если подходящего нет — берём весь гардероб: лучше не по сезону, чем без
    // одежды вовсе.
    const fitting = wardrobe.filter((w) => suits(w, ctx));
    const pool = fitting.length ? fitting : wardrobe;

    const { data: history } = await supabase
        .from('tamara_outfit_day')
        .select('wardrobe_id, on_date')
        .order('on_date', { ascending: false })
        .limit(400);

    const lastWorn = new Map<number, string>();
    for (const h of (history ?? []) as any[]) {
        const id = Number(h.wardrobe_id);
        if (!lastWorn.has(id)) lastWorn.set(id, String(h.on_date));
    }

    // Ни разу не надёванное идёт вперёд: пустая строка меньше любой даты.
    const sorted = [...pool].sort((a, b) => {
        const wa = lastWorn.get(a.id) ?? '';
        const wb = lastWorn.get(b.id) ?? '';
        return wa === wb ? a.id - b.id : wa < wb ? -1 : 1;
    });

    const outfit = sorted[0];
    const worn = lastWorn.get(outfit.id);
    const reason =
        `${describeContext(ctx)}; ` +
        (fitting.length ? `подходящих образов ${fitting.length}` : 'подходящих по условиям нет, взят любой') +
        `; ${worn ? `последний раз надевался ${worn}` : 'ни разу не надевался'}`;

    await supabase
        .from('tamara_outfit_day')
        .upsert({ on_date: date, wardrobe_id: outfit.id, reason }, { onConflict: 'on_date' });

    return { outfit, reason };
}

/** Что показывать на экране сейчас. Ничего не выбирает — только читает. */
export async function outfitOfDay(date: string): Promise<{ outfit: Wardrobe; reason: string } | null> {
    const { data } = await supabase
        .from('tamara_outfit_day')
        .select('wardrobe_id, reason, image_url')
        .eq('on_date', date)
        .maybeSingle();
    if (!data) return null;

    const { data: w } = await supabase
        .from('tamara_wardrobe')
        .select('*')
        .eq('id', (data as any).wardrobe_id)
        .maybeSingle();
    if (!w || !(w as any).active) return null;

    // Ночной кадр главнее принятого: задание то же, но кадр сегодняшний. Если
    // отрисовка не сработала, остаётся принятый — одетой она выйдет в любом
    // случае.
    const fresh = String((data as any).image_url ?? '');
    const outfit = fresh ? ({ ...(w as Wardrobe), image_url: fresh }) : (w as Wardrobe);

    return { outfit, reason: String((data as any).reason ?? '') };
}

export async function outfitEnabled(): Promise<boolean> {
    const { data } = await supabase
        .from('shtab_settings')
        .select('value')
        .eq('key', 'outfit_enabled')
        .maybeSingle();
    return String((data as any)?.value ?? 'true') === 'true';
}
