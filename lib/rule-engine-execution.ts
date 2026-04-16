import { runRuleEngine } from '@/lib/rule-engine';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

const WORKER_KEY = 'system_jobs.rule_engine';

export function isRealtimeRuleEngineEnabled() {
  return process.env.ENABLE_SYSTEM_JOBS_PIPELINE === 'true';
}

export async function executeRuleEngineWindow(input?: {
  hours?: number;
  targetRuleId?: string;
}) {
  const now = new Date();
  const hours = Math.max(1, input?.hours || 24);
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

  try {
    const violationsFound = await runRuleEngine(start.toISOString(), now.toISOString(), input?.targetRuleId);

    await supabase.from('sync_state').upsert({
      key: 'rule_engine_last_run',
      value: now.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: 'key' });

    await recordWorkerSuccess(WORKER_KEY, {
      hours,
      violations_found: violationsFound,
      target_rule_id: input?.targetRuleId || null,
    });

    return {
      ok: true,
      status: 'completed' as const,
      hours,
      violations_found: violationsFound,
      analyzed_window: {
        start: start.toISOString(),
        end: now.toISOString(),
      },
    };
  } catch (error: any) {
    await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown rule engine worker error', {
      hours,
      target_rule_id: input?.targetRuleId || null,
    });
    throw error;
  }
}