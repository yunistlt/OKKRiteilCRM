import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    const now = new Date();

    // 1. Call row status distribution — individual counts per status
    const statuses = ['pending', 'processing', 'completed', 'failed', 'skipped'] as const;
    const countByStatus: Record<string, number> = {};

    await Promise.all(
      statuses.map(async (s) => {
        const { count } = await supabase
          .from('raw_telphin_calls')
          .select('telphin_call_id', { count: 'exact', head: true })
          .eq('transcription_status', s);
        countByStatus[s] = count ?? 0;
      })
    );

    // 2. Stale processing calls (processing > 5 min via started_at)
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const { count: staleProcessingCount } = await supabase
      .from('raw_telphin_calls')
      .select('telphin_call_id', { count: 'exact', head: true })
      .eq('transcription_status', 'processing')
      .lt('started_at', fiveMinutesAgo);

    // Sample stale calls
    const { data: staleSample } = await supabase
      .from('raw_telphin_calls')
      .select('telphin_call_id, started_at')
      .eq('transcription_status', 'processing')
      .lt('started_at', fiveMinutesAgo)
      .order('started_at', { ascending: true })
      .limit(5);

    // 3. system_jobs queue state for call_transcription
    const jobStatuses = ['queued', 'processing', 'completed', 'failed', 'dead_letter'] as const;
    const jobCountByStatus: Record<string, number> = {};
    await Promise.all(
      jobStatuses.map(async (s) => {
        const { count } = await supabase
          .from('system_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('job_type', 'call_transcription')
          .eq('status', s);
        jobCountByStatus[s] = count ?? 0;
      })
    );

    // 4. Jobs with lock error (the "already being transcribed" stale indicator)
    const { count: lockErrCount } = await supabase
      .from('system_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('job_type', 'call_transcription')
      .eq('status', 'queued')
      .ilike('last_error', '%already being transcribed%');

    // 5. Top errors in queued jobs
    const { data: topErrors } = await supabase
      .from('system_jobs')
      .select('last_error, attempts, updated_at')
      .eq('job_type', 'call_transcription')
      .eq('status', 'queued')
      .not('last_error', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(10);

    // Aggregate error messages
    const errorGroups: Record<string, number> = {};
    for (const row of topErrors || []) {
      const key = String(row.last_error || '').slice(0, 120);
      errorGroups[key] = (errorGroups[key] || 0) + 1;
    }
    const topErrorSummary = Object.entries(errorGroups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([msg, count]) => ({ msg, count }));

    // 6. Worker state
    const { data: syncRows } = await supabase
      .from('sync_state')
      .select('key, value')
      .in('key', [
        'system_jobs.transcription.last_success_at',
        'system_jobs.transcription.last_success_meta',
        'system_jobs.transcription.last_error',
      ]);

    const syncMap = Object.fromEntries((syncRows || []).map((r: any) => [r.key, r.value]));
    const lastSuccessAt = syncMap['system_jobs.transcription.last_success_at'];
    const lastSuccessAgeSeconds = lastSuccessAt
      ? Math.round((now.getTime() - new Date(lastSuccessAt).getTime()) / 1000)
      : null;

    // 7. Assess health
    const alerts: string[] = [];
    const stale = staleProcessingCount ?? 0;
    if (stale > 0) {
      alerts.push(`${stale} call(s) stuck in 'processing' >5 min — Vercel timeout residue`);
    }
    if ((lockErrCount ?? 0) > 0) {
      alerts.push(`${lockErrCount} queued job(s) have stale lock error — should auto-recover`);
    }
    if (jobCountByStatus['dead_letter'] > 0) {
      alerts.push(`${jobCountByStatus['dead_letter']} dead_letter job(s) need manual review`);
    }
    const workerStalled =
      lastSuccessAgeSeconds !== null &&
      lastSuccessAgeSeconds > 180 &&
      (jobCountByStatus['queued'] || 0) > 0;
    if (workerStalled) {
      alerts.push(`Worker last success was ${Math.round(lastSuccessAgeSeconds! / 60)} min ago with queue non-empty`);
    }

    return NextResponse.json({
      ok: true,
      checked_at: now.toISOString(),
      healthy: alerts.length === 0,
      alerts,
      call_rows: countByStatus,
      stale_processing: {
        count: staleProcessingCount ?? 0,
        sample: (staleSample || []).map((r: { telphin_call_id: string; started_at: string }) => ({
          id: r.telphin_call_id.slice(0, 8),
          age_min: Math.round((now.getTime() - new Date(r.started_at).getTime()) / 60000),
        })),
      },
      system_jobs: jobCountByStatus,
      lock_err_queued: lockErrCount ?? 0,
      top_errors: topErrorSummary,
      worker: {
        last_success_at: lastSuccessAt || null,
        last_success_age_seconds: lastSuccessAgeSeconds,
        last_success_meta: syncMap['system_jobs.transcription.last_success_meta'] || null,
        last_error: syncMap['system_jobs.transcription.last_error'] || null,
        stalled: workerStalled,
      },
    });
  } catch (e: any) {
    const isUnauthorized = e.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}
