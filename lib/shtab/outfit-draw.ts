import { supabase } from '@/utils/supabase';

/**
 * Отрисовка образа: сервис шьёт Тамаре одежду сам, ночью.
 *
 * Всё держится на одном: на кадре должна быть та же женщина. Держится она
 * ссылкой на эталонный снимок с image_reference = subject — Kling берёт оттуда
 * лицо и телосложение, а одежду рисует по заданию. Без этой ссылки каждую ночь
 * приходила бы новая женщина, и вся затея теряет смысл.
 *
 * Ключи отдельные от веб-подписки: у кабинета разработчика свой AccessKey и
 * SecretKey. Пока их нет, отрисовка молча не работает — а гардероб продолжает
 * выдавать уже принятые образы, и Штаб не остаётся с пустым силуэтом.
 */

export type DrawResult =
    | { ok: true; png: Buffer }
    | { ok: false; reason: string; configured: boolean };

export function drawConfigured(): boolean {
    return Boolean(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);
}

const API = 'https://api-singapore.klingai.com';

/**
 * Токен для Kling — JWT HS256, подписанный секретным ключом.
 *
 * Собирается руками, без библиотеки: зависимость ради трёх base64url и одной
 * подписи не окупается, а криптография здесь штатная, из node:crypto.
 */
async function klingToken(): Promise<string> {
    const { createHmac } = await import('crypto');
    const ak = process.env.KLING_ACCESS_KEY!;
    const sk = process.env.KLING_SECRET_KEY!;
    const now = Math.floor(Date.now() / 1000);

    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    // nbf на полминуты назад: часы прода и Kling расходятся, и токен «из
    // будущего» отвергается.
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ iss: ak, exp: now + 1800, nbf: now - 30 });
    const sig = createHmac('sha256', sk).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
}

async function settings(keys: string[]): Promise<Map<string, string>> {
    const { data } = await supabase.from('shtab_settings').select('key, value').in('key', keys);
    return new Map(((data ?? []) as any[]).map((r) => [String(r.key), String(r.value ?? '')]));
}

/** Задание целиком: общая часть плюс одежда этого образа. */
export async function buildPrompt(outfitPrompt: string): Promise<string> {
    const map = await settings(['outfit_base_prompt']);
    const base = map.get('outfit_base_prompt') ?? '';
    // Одежда идёт первой: в длинном задании модель точнее держит начало.
    return `${outfitPrompt.trim()} ${base.replace(/<<<ЭЛЕМЕНТ>>>\s*/g, '')}`.trim();
}

/**
 * Нарисовать образ по заданию.
 *
 * Ждём результата опросом: задача ставится в очередь, картинка приходит через
 * полминуты-минуту. Дольше минут трёх не ждём — ночной крон не должен висеть,
 * а невыполненный кадр значит лишь, что утром будет вчерашний образ.
 */
export async function drawOutfit(prompt: string, referenceUrl: string): Promise<DrawResult> {
    if (!drawConfigured()) {
        return { ok: false, configured: false, reason: 'нет ключей Kling: KLING_ACCESS_KEY / KLING_SECRET_KEY' };
    }

    try {
        const token = await klingToken();
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

        const created = await fetch(`${API}/v1/images/generations`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model_name: 'kling-v1-5',
                prompt,
                // Лицо и телосложение берутся отсюда. Вес близко к единице:
                // при меньшем модель начинает «улучшать» внешность.
                image: referenceUrl,
                image_reference: 'subject',
                image_fidelity: 0.9,
                aspect_ratio: '2:3',
                n: 1,
            }),
        });
        const start: any = await created.json();
        if (!created.ok || start?.code) {
            return { ok: false, configured: true, reason: `Kling отказал: ${String(start?.message ?? created.status)}` };
        }

        const taskId = start?.data?.task_id;
        if (!taskId) return { ok: false, configured: true, reason: 'Kling не вернул номер задачи' };

        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 6000));
            const res = await fetch(`${API}/v1/images/generations/${taskId}`, { headers });
            const json: any = await res.json();
            const status = json?.data?.task_status;
            if (status === 'succeed') {
                const url = json?.data?.task_result?.images?.[0]?.url;
                if (!url) return { ok: false, configured: true, reason: 'Kling вернул задачу без картинки' };
                const img = await fetch(url);
                if (!img.ok) return { ok: false, configured: true, reason: 'картинка не скачалась' };
                return { ok: true, png: Buffer.from(await img.arrayBuffer()) };
            }
            if (status === 'failed') {
                return { ok: false, configured: true, reason: String(json?.data?.task_status_msg ?? 'Kling не справился') };
            }
        }

        return { ok: false, configured: true, reason: 'Kling не успел за три минуты' };
    } catch (e: any) {
        return { ok: false, configured: true, reason: String(e?.message ?? e) };
    }
}

/** Положить нарисованное в хранилище и вернуть ссылку. */
export async function storeOutfit(slug: string, date: string, png: Buffer): Promise<string | null> {
    const path = `tamara-wardrobe/daily/${date}-${slug}.png`;
    const up = await supabase.storage.from('okk-assets').upload(path, png, {
        contentType: 'image/png',
        upsert: true,
    });
    if (up.error) return null;
    const {
        data: { publicUrl },
    } = supabase.storage.from('okk-assets').getPublicUrl(path);
    return publicUrl;
}
