// utils/workingHistory.js

let workingStatusCodesCache = null;

/**
 * Загружаем список кодов рабочих статусов из okk_sla_status
 */
async function loadWorkingStatusCodes(supabase) {
  if (workingStatusCodesCache) return workingStatusCodesCache;

  const { data, error } = await supabase
    .from('okk_sla_status')
    .select('status_code')
    .eq('is_active', true);

  if (error) {
    console.error('loadWorkingStatusCodes error', error);
    throw error;
  }

  workingStatusCodesCache = (data || [])
    .map((row) => row.status_code)
    .filter(Boolean);

  return workingStatusCodesCache;
}

/**
 * Достаём код статуса из new_value (там лежит JSON-строка)
 */
function extractStatusCodeFromNewValue(raw) {
  if (!raw) return null;

  // пробуем распарсить JSON
  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === 'string') {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      // самые типичные варианты
      if (typeof parsed.code === 'string') return parsed.code;
      if (typeof parsed.status === 'string') return parsed.status;
      if (typeof parsed.id === 'string') return parsed.id;
    }
  } catch {
    // не JSON — идём дальше
  }

  if (typeof raw === 'string') {
    // срезаем лишние кавычки, если вдруг есть
    return raw.replace(/^"+|"+$/g, '');
  }

  return null;
}

/**
 * Копируем строки по рабочим статусам в okk_order_history_working
 * (контрольный механизм к триггеру)
 */
export async function copyWorkingHistoryRows(supabase, historyRows) {
  if (!historyRows?.length) return;

  const workingCodes = await loadWorkingStatusCodes(supabase);

  const rowsToInsert = [];

  for (const row of historyRows) {
    if (row.field_name !== 'status') continue;

    const statusCode = extractStatusCodeFromNewValue(row.new_value);
    if (!statusCode) continue;

    if (!workingCodes.includes(statusCode)) continue;

    rowsToInsert.push({
      // id не задаём — пусть БД сама генерит uuid по default
      order_id: row.order_id ?? null,
      retailcrm_order_id: row.retailcrm_order_id ?? null,
      changed_at: row.changed_at ?? null,
      changer_retailcrm_user_id: row.changer_retailcrm_user_id ?? null,
      changer_id: row.changer_id ?? null,
      change_type: row.change_type ?? null,
      field_name: row.field_name ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
      comment: row.comment ?? null,
      raw_payload: row.raw_payload ?? null,
    });
  }

  if (!rowsToInsert.length) return;

  const { error } = await supabase
    .from('okk_order_history_working')
    .insert(rowsToInsert);

  if (error) {
    console.error('copyWorkingHistoryRows insert error', error);
    throw error;
  }
}

/**
 * Удаляем историю по заказу из рабочей таблицы,
 * когда он вышел из рабочих статусов (вызывать из синка заказов)
 */
export async function clearWorkingHistoryForOrder(supabase, orderId) {
  if (!orderId) return;

  const { error } = await supabase
    .from('okk_order_history_working')
    .delete()
    .eq('order_id', orderId);

  if (error) {
    console.error('clearWorkingHistoryForOrder error', error);
    throw error;
  }
}
