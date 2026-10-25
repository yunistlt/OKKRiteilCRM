/**
 * Отдача записи разговора браузеру — одна на всю систему.
 *
 * Плееров записи три: список звонков, экран контроля качества и карточка
 * заказа. Прокси под них было два, с разным поведением, и чинили их по
 * очереди: 05.10.2026 — тот, что под ОКК, 20.10.2026 — тот, что под списком
 * звонков. Поэтому логика здесь одна, а маршруты только зовут её.
 *
 * Что здесь важно (проверено на живых записях 20.10.2026):
 *
 *  - хранилище Телфина отдаёт mp3 как `application/octet-stream` с пометкой
 *    «скачать файлом». Браузер такое не играет, а сохраняет — тип ставим свой;
 *
 *  - Safari проигрывает звук только кусками: просит `Range: bytes=0-1` и без
 *    частичного ответа остаётся пустым («--:--»). Хранилище кусками не умеет —
 *    пишет `accept-ranges: bytes`, а на запрос куска отдаёт файл целиком.
 *    Значит режем сами;
 *
 *  - запись разговора не кэшируем: это защищённые данные.
 */
import { NextResponse } from 'next/server';
import { getTelphinToken } from '@/lib/telphin';

const NO_STORE_AUDIO_HEADERS = {
    'Cache-Control': 'private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
};

/**
 * Ходим только в хранилище записей Телфина.
 *
 * Маршрут подставляет наш токен в чужой запрос — без проверки адреса по нему
 * можно было бы отправить сервер куда угодно.
 */
const ALLOWED_HOSTS = new Set(['storage.telphin.ru', 'apiproxy.telphin.ru']);

function allowed(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

/** `bytes=0-1`, `bytes=1000-`, `bytes=-500` — что именно просит плеер. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
    if (!header) return null;

    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;

    const [, rawStart, rawEnd] = match;

    if (!rawStart) {
        const length = Number(rawEnd);
        if (!Number.isFinite(length) || length <= 0) return null;
        return { start: Math.max(0, size - length), end: size - 1 };
    }

    const start = Number(rawStart);
    const end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isFinite(start) || start >= size || end < start) return null;

    return { start, end: Math.min(end, size - 1) };
}

export async function serveCallRecording(request: Request): Promise<Response> {
    const url = new URL(request.url).searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Не указана запись разговора' }, { status: 400 });
    }
    if (!allowed(url)) {
        return NextResponse.json({ error: 'Эта ссылка не из хранилища записей' }, { status: 400 });
    }

    try {
        const token = await getTelphinToken();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        if (!res.ok) {
            console.error('[Запись разговора] Телфин ответил', res.status, res.statusText);
            return NextResponse.json(
                { error: 'Запись разговора не отдалась' },
                { status: 502, headers: NO_STORE_AUDIO_HEADERS },
            );
        }

        /** Запись весит полмегабайта: кусок у Телфина не попросишь, держим целиком. */
        const file = Buffer.from(await res.arrayBuffer());

        const headers: Record<string, string> = {
            'Content-Type': 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            ...NO_STORE_AUDIO_HEADERS,
        };

        const range = parseRange(request.headers.get('range'), file.length);
        if (range) {
            const chunk = file.subarray(range.start, range.end + 1);
            return new Response(new Uint8Array(chunk), {
                status: 206,
                headers: {
                    ...headers,
                    'Content-Range': `bytes ${range.start}-${range.end}/${file.length}`,
                    'Content-Length': String(chunk.length),
                },
            });
        }

        return new Response(new Uint8Array(file), {
            headers: { ...headers, 'Content-Length': String(file.length) },
        });
    } catch (e: any) {
        console.error('[Запись разговора] не отдалась:', e?.message);
        return NextResponse.json(
            { error: 'Запись разговора не отдалась' },
            { status: 500, headers: NO_STORE_AUDIO_HEADERS },
        );
    }
}
