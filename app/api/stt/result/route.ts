import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { finalizeTranscript, finalizeTranscriptFromChannels } from '@/lib/transcribe';
import { enqueueTranscriptionDownstream } from '@/lib/transcription-downstream';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
    const token = process.env.STT_WORKER_TOKEN;
    if (!token) return false;
    return req.headers.get('x-worker-token') === token;
}

// Внешний STT-воркер возвращает результат расшифровки. Диаризация ролей и AMD остаются на нашей
// стороне (OpenAI блокирует российские IP — с сервера их не вызвать), здесь же и downstream.
export async function POST(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

    const callId = body?.call_id;
    if (!callId) return NextResponse.json({ error: 'call_id required' }, { status: 400 });

    const status = body?.status || (body?.text != null ? 'done' : 'error');

    if (status === 'error') {
        await supabase.from('raw_telphin_calls').update({
            transcription_status: 'failed',
            stt_job_id: null,
            am_detection_result: {
                reason: `external STT error: ${String(body?.error || '').slice(0, 200)}`,
                processed_at: new Date().toISOString(),
            },
        }).eq('telphin_call_id', callId);
        return NextResponse.json({ ok: true, call_id: callId, state: 'failed' });
    }

    try {
        // Стерео: сегменты с номером канала → детерминированные роли (без угадывания).
        // Иначе моно: сырой текст → текстовая диаризация (gpt-4o-mini).
        const segments = body?.segments;
        if (Number(body?.channels) === 2 && Array.isArray(segments) && segments.some((s: any) => s?.channel === 0 || s?.channel === 1)) {
            await finalizeTranscriptFromChannels(callId, segments);
        } else {
            await finalizeTranscript(callId, typeof body?.text === 'string' ? body.text : '');
        }
        const downstream = await enqueueTranscriptionDownstream(callId, 'external_stt');
        return NextResponse.json({ ok: true, call_id: callId, state: 'completed', order_id: downstream.orderId });
    } catch (e: any) {
        return NextResponse.json({ ok: false, call_id: callId, error: e?.message }, { status: 500 });
    }
}
