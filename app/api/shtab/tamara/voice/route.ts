import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { runSpeechToText } from '@/lib/transcribe';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/shtab/tamara/voice — надиктованное в текст.
//
// Распознаёт то же, что и звонки: свой STT-сервер, а без него — Whisper.
// Своего распознавания в браузере здесь нет намеренно: Web Speech API у разных
// браузеров разный, в Safari он уезжает в чужое облако, а звонки мы и так
// распознаём сами.
//
// Текст возвращается в поле ввода, а не отправляется сразу: надиктованное почти
// всегда надо поправить, а «структура компании» на слух превращается во что
// угодно.

/** Минута речи — это примерно мегабайт; четырёх хватает с запасом. */
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const form = await req.formData();
        const audio = form.get('audio');
        if (!(audio instanceof File)) return NextResponse.json({ error: 'Записи не пришло' }, { status: 400 });
        if (audio.size === 0) return NextResponse.json({ error: 'Запись пустая' }, { status: 400 });
        if (audio.size > MAX_BYTES) {
            return NextResponse.json({ error: 'Запись длиннее, чем принимается за раз — надиктуй частями' }, { status: 400 });
        }

        // Имя с расширением обязательно: и свой STT, и Whisper определяют
        // формат по нему, а File из FormData приезжает как «blob».
        const ext = (audio.type.split('/')[1] || 'webm').split(';')[0];
        const named = new File([await audio.arrayBuffer()], `dictation.${ext}`, { type: audio.type || 'audio/webm' });

        const text = (await runSpeechToText(named)).trim();
        if (!text) return NextResponse.json({ error: 'Ничего не разобрала — попробуй ещё раз' }, { status: 422 });

        return NextResponse.json({ text });
    } catch (e: any) {
        return NextResponse.json({ error: `Не распозналось: ${e.message}` }, { status: 500 });
    }
}
