import { supabase } from '@/utils/supabase';

const LOOKBACK_DAYS = 35;
const MATCH_BATCH_SIZE = 1000;

interface DialogueStatsRow {
  manager_id: string;
  d1_count: number;
  d1_duration: number;
  d7_count: number;
  d7_duration: number;
  d30_count: number;
  d30_duration: number;
  updated_at: string;
}

function buildEmptyStatsRow(managerId: string, nowIso: string): DialogueStatsRow {
  return {
    manager_id: managerId,
    d1_count: 0,
    d1_duration: 0,
    d7_count: 0,
    d7_duration: 0,
    d30_count: 0,
    d30_duration: 0,
    updated_at: nowIso,
  };
}

async function getControlledManagerIds(managerIds?: Array<number | string>) {
  let query = supabase
    .from('manager_settings')
    .select('id')
    .eq('is_controlled', true);

  if (managerIds?.length) {
    query = query.in('id', managerIds.map((managerId) => String(managerId)));
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data || []).map((row: any) => String(row.id));
}

async function fetchManagerMatches(managerId: string, startStr: string) {
  const allMatches: any[] = [];
  let from = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from('call_order_matches')
      .select(`
        telphin_call_id,
        retailcrm_order_id,
        raw_telphin_calls (duration_sec, started_at),
        orders!inner (manager_id)
      `)
      .gte('matched_at', startStr)
      .eq('orders.manager_id', managerId)
      .range(from, from + MATCH_BATCH_SIZE - 1);

    if (error) {
      throw error;
    }

    if (!batch?.length) {
      break;
    }

    allMatches.push(...batch);

    if (batch.length < MATCH_BATCH_SIZE) {
      break;
    }

    from += MATCH_BATCH_SIZE;
  }

  return allMatches;
}

function aggregateDialogueStats(managerId: string, matches: any[], now: Date): DialogueStatsRow {
  const stats = buildEmptyStatsRow(managerId, now.toISOString());
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const match of matches) {
    const call = match.raw_telphin_calls as any;
    if (!call?.started_at) {
      continue;
    }

    const duration = call.duration_sec || 0;
    const startedAt = new Date(call.started_at);

    stats.d30_count += 1;
    stats.d30_duration += duration;

    if (startedAt >= sevenDaysAgo) {
      stats.d7_count += 1;
      stats.d7_duration += duration;
    }

    if (startedAt >= oneDayAgo) {
      stats.d1_count += 1;
      stats.d1_duration += duration;
    }
  }

  return stats;
}

export async function refreshManagerDialogueStats(managerId: number | string) {
  const normalizedManagerId = String(managerId);
  const controlledManagerIds = await getControlledManagerIds([normalizedManagerId]);

  if (!controlledManagerIds.includes(normalizedManagerId)) {
    await supabase.from('dialogue_stats').delete().eq('manager_id', normalizedManagerId);
    return {
      managerId: normalizedManagerId,
      status: 'skipped_not_controlled',
      matchesFound: 0,
      callsLinked: 0,
    };
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);
  const startStr = startDate.toISOString();
  const now = new Date();

  const matches = await fetchManagerMatches(normalizedManagerId, startStr);
  const row = aggregateDialogueStats(normalizedManagerId, matches, now);

  const { error } = await supabase
    .from('dialogue_stats')
    .upsert(row, { onConflict: 'manager_id' });

  if (error) {
    throw error;
  }

  return {
    managerId: normalizedManagerId,
    status: 'updated',
    matchesFound: matches.length,
    callsLinked: row.d30_count,
    updatedAt: row.updated_at,
  };
}

export async function refreshControlledManagersDialogueStats(managerIds?: Array<number | string>) {
  const controlledManagerIds = await getControlledManagerIds(managerIds);
  const results: Array<Record<string, any>> = [];

  for (const managerId of controlledManagerIds) {
    results.push(await refreshManagerDialogueStats(managerId));
  }

  return results;
}