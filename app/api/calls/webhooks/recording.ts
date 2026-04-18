import { supabase } from '@/utils/supabase';
import { safeEnqueueCallTranscriptionJob, safeEnqueueSystemJob } from '@/lib/system-jobs';
import { bestEffortUpdateLegacyCallRecording } from '@/lib/telphin-legacy-compat';
import { syncCanonicalTelphinCallFromWebhook } from '@/lib/telphin-webhook-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const recordingReadyAt = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();

    const {
      call_id,
      recording_url,
      duration_seconds,
      timestamp,
    } = payload;

    await bestEffortUpdateLegacyCallRecording({
      callId: call_id,
      recordingUrl: recording_url,
    });

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

    await safeEnqueueSystemJob({
      jobType: 'call_match',
      payload: {
        telphin_call_id: call_id,
        source: 'recording_webhook',
      },
      priority: 30,
      idempotencyKey: `call_match:${call_id}:recording`,
    });

    if (canonicalSync.queuedForTranscription) {
      await safeEnqueueCallTranscriptionJob({
        callId: call_id,
        source: 'recording_webhook',
        recordingUrl: recording_url,
        startedAt: canonicalSync.startedAt,
        payload: {
          recording_ready_at: recordingReadyAt,
        },
      });
    }

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
