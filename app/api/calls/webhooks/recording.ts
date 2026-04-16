import { supabase } from '@/utils/supabase';
import { safeEnqueueSystemJob } from '@/lib/system-jobs';
import { syncCanonicalTelphinCallFromWebhook } from '@/lib/telphin-webhook-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const {
      call_id,
      recording_url,
      duration_seconds,
      timestamp,
    } = payload;

    // Обновляем запись в таблице звонков
    const { data: outgoingCall } = await supabase
      .from('outgoing_calls')
      .update({
        recording_url,
      })
      .eq('call_sid', call_id)
      .select()
      .single();

    if (!outgoingCall) {
      const { error } = await supabase
        .from('incoming_calls')
        .update({
          recording_url,
        })
        .eq('call_sid', call_id);

      if (error) throw error;
    }

    const canonicalSync = await syncCanonicalTelphinCallFromWebhook({
      callId: call_id,
      payload,
      recordingUrl: recording_url,
      durationSeconds: duration_seconds,
      startedAt: timestamp ? new Date(timestamp).toISOString() : null,
      status: 'recording_ready',
      queueForTranscription: true,
    });

    await safeEnqueueSystemJob({
      jobType: 'telphin_call_upsert',
      payload: {
        telphin_call_id: call_id,
        source: 'recording_webhook',
        started_at: canonicalSync.startedAt,
        recording_url,
      },
      priority: 20,
      idempotencyKey: `telphin_call_upsert:${call_id}:recording`,
    });

    if (canonicalSync.queuedForTranscription) {
      await safeEnqueueSystemJob({
        jobType: 'call_transcription',
        payload: {
          telphin_call_id: call_id,
          source: 'recording_webhook',
          recording_url,
        },
        priority: 10,
        idempotencyKey: `call_transcription:${call_id}`,
      });
    }

    // Добавляем запись на очередь транскрибации
    await supabase.from('transcription_queue').insert({
      call_id: call_id,
      recording_url,
      type: outgoingCall ? 'outgoing_call' : 'incoming_call',
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      callId: call_id,
      recordingQueued: true,
    });
  } catch (error) {
    console.error('Recording webhook error:', error);
    return NextResponse.json(
      { error: 'Recording processing failed' },
      { status: 500 }
    );
  }
}
