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
      status, // connected, completed, failed, missed
      duration_seconds,
      recording_url,
      started_at,
      ended_at,
    } = payload;

    // Определяем, исходящий или входящий звонок
    const { data: outgoingCall } = await supabase
      .from('outgoing_calls')
      .select('id')
      .eq('call_sid', call_id)
      .single();

    const { data: incomingCall } = await supabase
      .from('incoming_calls')
      .select('id, order_id')
      .eq('call_sid', call_id)
      .single();

    if (outgoingCall) {
      // Обновляем исходящий звонок
      const { error } = await supabase
        .from('outgoing_calls')
        .update({
          status,
          duration_seconds,
          recording_url,
          answered_at: status === 'connected' ? new Date().toISOString() : null,
          ended_at: ended_at ? new Date(ended_at).toISOString() : null,
        })
        .eq('call_sid', call_id);

      if (error) console.error('Update outgoing call error:', error);

    } else if (incomingCall) {
      // Обновляем входящий звонок
      const { error } = await supabase
        .from('incoming_calls')
        .update({
          status,
          duration_seconds,
          recording_url,
          answered_at: status === 'connected' ? new Date().toISOString() : null,
          ended_at: ended_at ? new Date(ended_at).toISOString() : null,
        })
        .eq('call_sid', call_id);

      if (error) console.error('Update incoming call error:', error);

      // Если звонок завершён и есть запись – триггер на транскрибацию
      if (recording_url && status === 'completed') {
        // Отправляем на очередь транскрибации
        await supabase.from('transcription_queue').insert({
          call_id: incomingCall.id,
          recording_url,
          type: 'incoming_call',
          status: 'pending',
          created_at: new Date().toISOString(),
        });
      }
    }

    const canonicalSync = await syncCanonicalTelphinCallFromWebhook({
      callId: call_id,
      payload,
      startedAt: started_at ? new Date(started_at).toISOString() : null,
      recordingUrl: recording_url,
      durationSeconds: duration_seconds,
      status,
      queueForTranscription: Boolean(recording_url && status === 'completed'),
    });

    await safeEnqueueSystemJob({
      jobType: 'telphin_call_upsert',
      payload: {
        telphin_call_id: call_id,
        source: 'status_update_webhook',
        started_at: canonicalSync.startedAt,
        status,
      },
      priority: 20,
      idempotencyKey: `telphin_call_upsert:${call_id}:status:${status}`,
    });

    await safeEnqueueSystemJob({
      jobType: 'call_match',
      payload: {
        telphin_call_id: call_id,
        source: 'status_update_webhook',
        status,
      },
      priority: 30,
      idempotencyKey: `call_match:${call_id}:status:${status}`,
    });

    if (canonicalSync.queuedForTranscription) {
      await safeEnqueueSystemJob({
        jobType: 'call_transcription',
        payload: {
          telphin_call_id: call_id,
          source: 'status_update_webhook',
          recording_url,
        },
        priority: 10,
        idempotencyKey: `call_transcription:${call_id}`,
      });
    }

    return NextResponse.json({
      success: true,
      callId: call_id,
      statusUpdated: status,
    });
  } catch (error) {
    console.error('Status update webhook error:', error);
    return NextResponse.json(
      { error: 'Status update failed' },
      { status: 500 }
    );
  }
}
