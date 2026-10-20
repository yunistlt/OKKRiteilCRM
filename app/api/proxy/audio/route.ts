/**
 * Запись разговора из хранилища Телфина — чтобы её можно было послушать прямо
 * в списке звонков, не скачивая файл.
 *
 * Жалоба Елены Парфёновой 20.10.2026: «нет возможности с раздела звонки
 * прослушать звонок». В Safari плеер появляется, но полоса пустая и время
 * «--:--»: файл до него не доезжает. В Chrome при этом играет.
 *
 * Две причины, обе здесь.
 *
 * 1. Safari проигрывает звук только кусками: он просит `Range: bytes=0-1`,
 *    и если сервер отвечает обычным «вот весь файл» (200 без Accept-Ranges),
 *    плеер остаётся пустым. Хранилище Телфина само кусками не умеет — пишет
 *    `accept-ranges: bytes`, а на запрос куска отдаёт файл целиком (проверено
 *    20.10.2026). Поэтому режем здесь: берём запись у Телфина и отдаём
 *    браузеру ровно тот кусок, который он попросил.
 *
 *    Сломалось это 19.04.2026 коммитом 9c4df9ec: у записи заменили
 *    `Cache-Control: public, max-age=3600` на `no-store`. Пока ответ
 *    кэшировался, Safari обходился без кусков. Кэш вернуть нельзя — запись
 *    разговора лежать в кэше не должна, — значит нужны куски.
 *
 * 2. Хранилище отдаёт mp3 с заголовками `content-type: application/octet-stream`
 *    и `content-disposition: attachment`, а мы пересылали их как есть. Для
 *    браузера это файл на скачивание, а не звук. Тип ставим свой.
 */
import { NextResponse } from 'next/server';
import { getTelphinToken } from '@/lib/telphin';

export const dynamic = 'force-dynamic';

const NO_STORE_AUDIO_HEADERS = {
    'Cache-Control': 'private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
};

/**
 * Ходим только в хранилище записей Телфина.
 *
 * Маршрут подставляет наш токен в чужой запрос — без этой проверки по нему
 * можно было бы сходить куда угодно от имени сервера.
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

/** `bytes=0-1`, `bytes=1000-` — что именно просит плеер. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
    if (!header) return null;

    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;

    const [, rawStart, rawEnd] = match;

    // «Последние N байт»: bytes=-500.
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

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

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
            console.error('[AudioProxy] Телфин ответил', res.status, res.statusText);
            return NextResponse.json(
                { error: 'Запись разговора не отдалась' },
                { status: 502, headers: NO_STORE_AUDIO_HEADERS },
            );
        }

        /**
         * Запись разговора — полмегабайта, держим её в памяти целиком: кусок
         * у Телфина всё равно не попросишь, он отдаёт файл целиком.
         */
        const file = Buffer.from(await res.arrayBuffer());

        const headers: Record<string, string> = {
            // Свой тип вместо октет-потока: иначе браузер скачивает файл
            // вместо воспроизведения.
            'Content-Type': 'audio/mpeg',
            // Куски поддерживаем — без этого Safari не начинает играть.
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
        console.error('[AudioProxy] Запись не отдалась:', e);
        return NextResponse.json(
            { error: 'Запись разговора не отдалась' },
            { status: 500, headers: NO_STORE_AUDIO_HEADERS },
        );
    }
}
