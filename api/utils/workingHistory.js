// utils/workingHistory.js

let workingStatusCodesCache = null;

/**
 * Загружаем список кодов рабочих статусов (status_code)
 * из okk_sla_status (is_active = TRUE)
 */
async function loadWorkingStatusCodes(supabase) {
  if (workingStatusCodesCache) return workingStatusCodesCache;

  const { data, error } = await supabase
    .from('okk_sla_status')
    .select('status_code')
    .eq('is_active', true);

  if (error) {
    console.error('loadWorkingStatusCodes error:', error);
    throw error;
  }

  workingStatusCodesCache = (data || [])
    .map((row) => row.status_code)
    .filter(Boolean);

  return workingStatusCodesCache;
}

/**
 * new_value в истории RetailCRM приходит в разных форматах:
 * - строка ("novyi-1")
 * - JSON-строка ("{\"code\":\"novyi-1\"}")
 * - объект { code: "novyi-1", ... }
 * Эта функция приводит всё к одному: чистый статус-код.
 */
function extractStatusCodeFromNewValue(raw) {
  if (!raw) return null;

  // Если пришел чистый код: "novyi-1"
  if (typeof raw === 'string' && /^[a-z0-9-]+$/i.test(raw)) {
    return raw;
  }

  // Если строка — возможно это JSON
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);

      // если JSON-строка → строка
      if (typeof parsed === 'string') return parsed;

      // если объект → достаём поле code
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.code === 'string') return parsed.code;
        if (typeof parsed.status === 'string') return parsed.status;
      }
    } catch {
      // строка не JSON
      return raw.replace(/^"+|"+$/g, '');
    }
  }

  // Если неожиданно прилетел object
  if (typeof raw === 'object') {
    if (typeof raw.code === 'string') return raw.code;
    if (typeof raw.status === 'string') return raw.status;
  }

  return null;
}

/**
 * Записываем строки (только рабочие статусы) в okk_order_history_working.
 * Это контрольный механизм на случай, если триггер не сработает.
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
      // id генерируется БД автоматически (default uuid)
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
    console.error('copyWorkingHistoryRows insert error:', error);
    throw error;
  }
}

/**
 * Очищаем рабочую историю, когда заказ выходит из рабочей воронки.
 * Вызывается из окк-sync-orders.js
 */
export async function clearWorkingHistoryForOrder(supabase, orderId) {
  if (!orderId) return;

  const { error } = await supabase
    .from('okk_order_history_working')
    .delete()
    .eq('order_id', orderId);

  if (error) {
    console.error('clearWorkingHistoryForOrder error:', error);
    throw error;
  }
}
