import { NextResponse } from 'next/server';
import { getTelphinToken } from '@/lib/telphin';

export const dynamic = 'force-dynamic';

const NO_STORE_AUDIO_HEADERS = {
    'Cache-Control': 'private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Missing audio URL' }, { status: 400 });
    }

    /**
     * Проигрыватель браузера просит файл кусками: сначала первые байты, потом
     * остальное. Без этого он показывает «0:00 / 0:00» и не играет — звонок
     * можно было только скачать (Лена Парфёнова 05.10.2026). Поэтому заголовок
     * Range передаём источнику как есть и возвращаем его ответ тем же кодом.
     */
    const range = request.headers.get('range');
    const headers: Record<string, string> = {};
    if (range) headers.Range = range;

    try {
        let res = await fetch(url, { headers });

        // Часть ссылок Телфина требует токен — пробуем его, если отказали.
        if ((res.status === 401 || res.status === 403) && !res.ok) {
            let token: string | null = null;
            try {
                token = await getTelphinToken();
            } catch {
                token = null;
            }

            if (token) {
                res = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
            }
        }

        if (!res.ok && res.status !== 206) {
            throw new Error(`Audio fetch failed: ${res.status}`);
        }

        /**
         * Телфин отдаёт запись как «application/octet-stream» и с пометкой
         * «скачать файлом» — браузер такое не проигрывает, только сохраняет.
         * На деле это обычный mp3 (ID3 + LAME в первых байтах), поэтому тип
         * выставляем сами, а пометку про скачивание не передаём.
         */
        const source = res.headers.get('content-type') || '';
        const contentType = source.startsWith('audio/') ? source : 'audio/mpeg';

        // Телфин не умеет отдавать куски — на Range он возвращает весь файл.
        // Режем сами, иначе проигрыватель не перематывает, а Safari и не играет.
        if (range && res.status === 200) {
            const buffer = Buffer.from(await res.arrayBuffer());
            const match = /bytes=(\d*)-(\d*)/.exec(range);
            const start = match?.[1] ? Number(match[1]) : 0;
            const end = match?.[2] ? Number(match[2]) : buffer.length - 1;
            const chunk = buffer.subarray(start, end + 1);

            const partial = new NextResponse(chunk, { status: 206 });
            partial.headers.set('Content-Type', contentType);
            partial.headers.set('Accept-Ranges', 'bytes');
            partial.headers.set('Content-Length', String(chunk.length));
            partial.headers.set('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
            Object.entries(NO_STORE_AUDIO_HEADERS).forEach(([key, value]) => {
                partial.headers.set(key, value);
            });
            return partial;
        }

        const response = new NextResponse(res.body, { status: res.status === 206 ? 206 : 200 });

        response.headers.set('Content-Type', contentType);
        // Перемотка: без этих заголовков ползунок не двигается.
        response.headers.set('Accept-Ranges', 'bytes');
        for (const key of ['content-length', 'content-range']) {
            const value = res.headers.get(key);
            if (value) response.headers.set(key, value);
        }
        Object.entries(NO_STORE_AUDIO_HEADERS).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return response;
    } catch (e: any) {
        console.error('[Проигрыватель звонка] не удалось отдать запись:', e?.message);
        return NextResponse.json({ error: e.message }, {
            status: 500,
            headers: NO_STORE_AUDIO_HEADERS,
        });
    }
}
