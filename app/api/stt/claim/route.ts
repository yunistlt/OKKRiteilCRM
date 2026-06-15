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

// Внешний STT-воркер забирает пачку звонков на расшифровку (id + ссылка на запись).
// Звонки помечаются 'submitted' с лизом — повторно не выдаются, пока воркер не вернёт результат
// или не истечёт 30 мин.
export async function GET(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '1', 10) || 1, 1), 20);

    const { data, error } = await supabase.rpc('claim_calls_for_external_stt', { p_limit: limit });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const calls = (data || []).map((r: any) => ({
        call_id: r.call_id,
        recording_url: r.recording_url,
        duration_sec: r.duration_sec,
        language: 'ru',
    }));

    return NextResponse.json({ calls });
}
