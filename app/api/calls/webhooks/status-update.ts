import { supabase } from '@/utils/supabase';
import { safeEnqueueCallTranscriptionJob, safeEnqueueSystemJob } from '@/lib/system-jobs';
import { bestEffortUpdateLegacyCallStatus } from '@/lib/telphin-legacy-compat';
import { syncCanonicalTelphinCallFromWebhook } from '@/lib/telphin-webhook-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TERMINAL_CALL_STATUSES = new Set([
  'completed',
  'failed',
  'missed',
  'cancelled',
  'busy',
  'no_answer',
]);

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

    const recordingReadyAt = recording_url && status === 'completed'
      ? new Date(ended_at || Date.now()).toISOString()
      : null;

    await bestEffortUpdateLegacyCallStatus({
      callId: call_id,
      status,
      durationSeconds: duration_seconds,
      recordingUrl: recording_url,
      answeredAt: status === 'connected' ? new Date().toISOString() : null,
      endedAt: ended_at ? new Date(ended_at).toISOString() : null,
    });

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

    // Sync with widget callback requests
    if (call_id) {
        const { data: callbackReq } = await supabase
            .from('widget_callback_requests')
            .select('*')
            .eq('telphin_call_id', call_id)
            .maybeSingle();

        if (callbackReq) {
            let nextStatus = callbackReq.status;
            
            if (status === 'connected') {
                nextStatus = 'calling_customer';
            } else if (status === 'completed') {
                nextStatus = 'completed';
            } else if (['failed', 'busy', 'no_answer', 'cancelled'].includes(status)) {
                // If it's a terminal failure from PBX
                nextStatus = 'failed';
            }

            if (nextStatus !== callbackReq.status) {
                await supabase
                    .from('widget_callback_requests')
                    .update({ 
                        status: nextStatus,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', callbackReq.id);
                
                // Add system message to chat
                let systemMsg = '';
                if (nextStatus === 'calling_customer') systemMsg = '📞 Менеджер на линии, соединяем с вами...';
                else if (nextStatus === 'completed') systemMsg = '✅ Звонок завершен. Спасибо за общение!';
                else if (nextStatus === 'failed') systemMsg = '❌ Не удалось установить соединение. Мы попробуем перезвонить позже.';

                if (systemMsg) {
                    await supabase.from('widget_messages').insert({
                        session_id: callbackReq.session_id,
                        role: 'system',
                        content: systemMsg
                    });
                }
            }
        }
    }

    const isTerminalStatus = TERMINAL_CALL_STATUSES.has(String(status || '').toLowerCase());
    let shouldEnqueueCallMatch = true;
    let callMatchSource = 'status_update_webhook';
    let callMatchIdempotencyKey = `call_match:${call_id}:status:${status}`;

    if (isTerminalStatus) {
      const { count: existingMatchesCount } = await supabase
        .from('call_order_matches')
        .select('id', { count: 'exact', head: true })
        .eq('telphin_call_id', call_id);

      shouldEnqueueCallMatch = !existingMatchesCount;
      if (shouldEnqueueCallMatch) {
        callMatchSource = 'call_end_webhook';
        callMatchIdempotencyKey = `call_match:${call_id}:call_end`;
      }
    }

    if (shouldEnqueueCallMatch) {
      await safeEnqueueSystemJob({
        jobType: 'call_match',
        payload: {
          telphin_call_id: call_id,
          source: callMatchSource,
          status,
          event: isTerminalStatus ? 'call_end' : 'status_update',
        },
        priority: 30,
        idempotencyKey: callMatchIdempotencyKey,
      });
    }

    if (canonicalSync.queuedForTranscription) {
      await safeEnqueueCallTranscriptionJob({
        callId: call_id,
        source: 'status_update_webhook',
        recordingUrl: recording_url,
        startedAt: canonicalSync.startedAt,
        payload: recordingReadyAt
          ? {
              recording_ready_at: recordingReadyAt,
            }
          : undefined,
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
