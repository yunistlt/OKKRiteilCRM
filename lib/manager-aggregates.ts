import { supabase } from '@/utils/supabase';

const LOOKBACK_DAYS = 35;

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

/**
 * Звонки менеджера за окно наблюдения.
 *
 * Сначала берём ВСЕ связки звонок↔заказ за окно (их около полутора тысяч за
 * 35 дней), и только потом спрашиваем, какие из этих заказов за менеджером.
 *
 * Раньше было наоборот: сперва все заказы менеджера, потом связки пачками по
 * 300 номеров. У менеджера бывает десять тысяч заказов (у Гордеевой 10 088, у
 * Матвеевой 11 726) — выходило под сорок запросов к тяжёлому представлению, и
 * пересчёт падал с «canceling statement due to statement timeout» (12 работ за
 * неделю). Теперь запросов к представлению два: связок за окно около полутора
 * тысяч, а база отдаёт их страницами по тысяче.
 *
 * Что считается, не меняется: то же окно, те же связки, те же заказы
 * менеджера — поменялся только порядок отбора.
 */
async function fetchManagerMatches(managerId: string, startStr: string) {
  // 1. Связки за окно — функцией, а не представлением call_order_link.
  //
  //    Представление отвечает «какие звонки к каким заказам относятся» по ВСЕЙ
  //    истории: читает все 60 тыс. звонков Телфина и в каждом разбирает JSON.
  //    Отобрать окно заранее оно не может — уникальность ног звонка считается по
  //    всей таблице. Выборка за 35 дней занимала 16,7 с, не укладывалась в
  //    таймаут, и 682 задания пересчёта падали по кругу (16.10.2026).
  //
  //    Функция отбирает звонки по датам сразу, а ноги выбирает уже среди них:
  //    ответ тот же (1 566 связок), время 574 мс. Страницы не нужны — она
  //    возвращает набор целиком, без потолка в тысячу строк.
  const { data: linkRows, error: linkError } = await supabase.rpc('call_order_links_for_period', {
    p_from: startStr,
    p_to: new Date().toISOString(),
  });
  if (linkError) {
    throw linkError;
  }
  const links = (linkRows ?? []) as any[];

  const orderIds = Array.from(new Set(links
    .map((link) => Number(link.order_id))
    .filter((id) => Number.isFinite(id))));
  if (!orderIds.length) {
    return [];
  }

  // 2. Кто из этих заказов за менеджером. Спрашиваем только про заказы со
  //    звонками, а не про все его десять тысяч.
  const mine = new Set<number>();
  for (let i = 0; i < orderIds.length; i += 300) {
    const { data, error } = await supabase
      .from('orders')
      .select('id')
      .eq('manager_id', managerId)
      .in('id', orderIds.slice(i, i + 300));
    if (error) {
      throw error;
    }
    for (const row of (data ?? []) as any[]) mine.add(Number(row.id));
  }

  return links.filter((link) => mine.has(Number(link.order_id)));
}


function aggregateDialogueStats(managerId: string, matches: any[], now: Date): DialogueStatsRow {
  const stats = buildEmptyStatsRow(managerId, now.toISOString());
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const match of matches) {
    if (!match?.started_at) {
      continue;
    }

    const duration = Number(match.duration_sec || 0);
    const startedAt = new Date(match.started_at);

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