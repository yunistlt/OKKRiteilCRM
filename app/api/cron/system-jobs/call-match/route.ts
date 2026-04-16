import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueOrderRefreshJob,
  failSystemJob,
  isSystemJobsPipelineEnabled,
} from '@/lib/system-jobs';
import { matchCallToOrders, RawCall, saveMatches } from '@/lib/call-matching';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function getRetryDelay(attempts: number) {
  if (attempts <= 1) return 30;
  if (attempts === 2) return 120;
  if (attempts === 3) return 300;
  return 900;
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!isSystemJobsPipelineEnabled()) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const workerId = `call-match-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['call_match'],
      limit: 5,
      lockSeconds: 180,
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { telphin_call_id?: string };
      const callId = payload.telphin_call_id;

      if (!callId) {
        await failSystemJob(job.id, 'Missing telphin_call_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const { data: callRow, error } = await supabase
          .from('raw_telphin_calls')
          .select('*')
          .eq('telphin_call_id', callId)
          .limit(1)
          .single();

        if (error || !callRow) {
          throw new Error(`Call ${callId} not found in raw_telphin_calls`);
        }

        const rawCall: RawCall = {
          telphin_call_id: callRow.telphin_call_id,
          from_number: callRow.from_number,
          to_number: callRow.to_number,
          from_number_normalized: callRow.from_number_normalized,
          to_number_normalized: callRow.to_number_normalized,
          started_at: callRow.started_at,
          direction: callRow.direction,
          raw_payload: callRow.raw_payload,
        };

        const matches = await matchCallToOrders(rawCall);
        if (matches.length > 0) {
          await saveMatches(matches);

          const uniqueOrderIds = Array.from(new Set(matches.map((match) => match.retailcrm_order_id)));
          for (const orderId of uniqueOrderIds) {
            await enqueueOrderRefreshJob({
              jobType: 'order_score_refresh',
              orderId,
              source: 'call_match_worker',
              payload: {
                telphin_call_id: callId,
              },
              priority: 25,
            });
          }
        }

        await completeSystemJob(job.id, {
          telphin_call_id: callId,
          matches_found: matches.length,
          matched_order_ids: matches.map((match) => match.retailcrm_order_id),
        });

        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'completed',
          matches_found: matches.length,
        });
      } catch (error: any) {
        await failSystemJob(job.id, error.message || 'Unknown call match worker error', getRetryDelay(job.attempts || 0));
        results.push({
          job_id: job.id,
          telphin_call_id: callId,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}