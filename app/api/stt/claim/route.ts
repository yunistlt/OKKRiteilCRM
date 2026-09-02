import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Машинная авторизация внешнего STT-воркера (его сервер в РФ, ходит к нам исходящим).
function authorized(req: NextRequest): boolean {
    const token = process.env.STT_WORKER_TOKEN;
    if (!token) return false; // не настроено — закрыто
    return req.headers.get('x-worker-token') === token;
}

// Заводское время (Тольятти, UTC+4) — по нему решаем, ночь сейчас или рабочий день.
const FACTORY_UTC_OFFSET_HOURS = 4;

/**
 * Ночное окно разбора хвоста: «час_начала-час_конца» по заводскому времени.
 * Лежит в sync_state (stt_backlog_window), а не в коде — окно двигают без деплоя.
 * Пусто или мусор → окно 0-7.
 */
async function backlogWindow(): Promise<{ from: number; to: number }> {
    const { data } = await supabase.from('sync_state').select('value').eq('key', 'stt_backlog_window').maybeSingle();
    const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec((data?.value || '').trim());
    if (!m) return { from: 0, to: 7 };
    return { from: Number(m[1]) % 24, to: Number(m[2]) % 24 };
}

function isInWindow(hour: number, { from, to }: { from: number; to: number }): boolean {
    // Окно через полночь (22-6) — не редкость, поэтому считаем по кругу.
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

// Внешний STT-воркер забирает пачку звонков на расшифровку (id + ссылка на запись).
// Звонки помечаются 'submitted' с лизом — повторно не выдаются, пока воркер не вернёт результат
// или не истечёт 30 мин.
//
// Днём отдаём свежие разговоры: они нужны ОКК и боту-РОПу сегодня. Ночью тот же воркер
// разбирает исторический хвост (звонки старше двух суток), не мешая свежим. Режим можно
// задать явно (?mode=backlog|fresh) — для ручного прогона и отладки.
export async function GET(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '1', 10) || 1, 1), 20);

    const mode = (searchParams.get('mode') || '').toLowerCase();
    let backlog: boolean;
    if (mode === 'backlog') backlog = true;
    else if (mode === 'fresh') backlog = false;
    else {
        const hour = new Date(Date.now() + FACTORY_UTC_OFFSET_HOURS * 3600_000).getUTCHours();
        backlog = isInWindow(hour, await backlogWindow());
    }

    const { data, error } = await supabase.rpc('claim_calls_for_external_stt', {
        p_limit: limit,
        p_backlog: backlog,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const calls = (data || []).map((r: any) => ({
        call_id: r.call_id,
        recording_url: r.recording_url,
        duration_sec: r.duration_sec,
        language: 'ru',
    }));

    return NextResponse.json({ calls, mode: backlog ? 'backlog' : 'fresh' });
}
