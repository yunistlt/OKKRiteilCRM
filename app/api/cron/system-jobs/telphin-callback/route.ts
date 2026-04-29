import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  failSystemJob,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';
import { initiateMakeCall } from '@/lib/telphin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.telphin_callback';
const MAX_CONCURRENCY = 2;

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!(await isSystemJobsPipelineRuntimeEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const workerId = `telphin-callback-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['telphin_callback'],
      limit: MAX_CONCURRENCY,
      lockSeconds: 120,
      maxProcessing: MAX_CONCURRENCY,
      concurrencyKey: WORKER_KEY,
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { visitorId: string; phone: string; sessionId: string };
      const { visitorId, phone, sessionId } = payload;

      if (!phone || !visitorId) {
        await failSystemJob(job.id, 'Missing phone or visitorId', 3600); // Don't retry soon
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        // 1. Check if there's an active request to avoid double calling
        const { data: activeRequest } = await supabase
            .from('widget_callback_requests')
            .select('*')
            .eq('visitor_id', visitorId)
            .eq('phone', phone)
            .in('status', ['calling_manager', 'calling_customer'])
            .maybeSingle();

        if (activeRequest) {
            await completeSystemJob(job.id, { status: 'skipped_active_call' });
            results.push({ job_id: job.id, status: 'skipped_active' });
            continue;
        }

        // 2. Initiate the call via Telphin
        const extensionId = process.env.TELPHIN_CALLBACK_EXTENSION || '101'; // Default or from env
        const source = process.env.TELPHIN_CALLBACK_SOURCE || '100'; // The ring group

        const telphinResult = await initiateMakeCall({
            extensionId,
            source,
            destination: phone
        });

        // 3. Update the request in DB
        await supabase
            .from('widget_callback_requests')
            .update({
                telphin_call_id: telphinResult.callId,
                status: 'calling_manager',
                updated_at: new Date().toISOString()
            })
            .eq('visitor_id', visitorId)
            .eq('phone', phone)
            .eq('status', 'pending');

        // 4. Optionally add a message to the chat
        await supabase.from('widget_messages').insert({
            session_id: sessionId,
            role: 'system',
            content: '📞 Инициирован обратный звонок. Дозваниваемся менеджерам...'
        });

        await completeSystemJob(job.id, {
          telphin_call_id: telphinResult.callId,
          status: 'initiated'
        });

        results.push({
          job_id: job.id,
          visitorId,
          status: 'completed'
        });
      } catch (error: any) {
        // Retry logic: 20s delay for PBX issues (e.g. all busy)
        await failSystemJob(job.id, error.message || 'Telphin callback error', 20);
        
        results.push({
          job_id: job.id,
          status: 'failed',
          error: error.message
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });
    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown callback worker error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}
