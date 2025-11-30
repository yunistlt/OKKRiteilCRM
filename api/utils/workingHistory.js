// utils/workingHistory.js
let workingStatusCodesCache = null;

async function loadWorkingStatusCodes(supabase) {
  if (workingStatusCodesCache) return workingStatusCodesCache;

  const { data, error } = await supabase
    .from('okk_sla_status')
    .select('status_code')
    .eq('is_active', true);

  if (error) throw error;

  workingStatusCodesCache = data.map((row) => row.status_code);
  return workingStatusCodesCache;
}

export async function copyWorkingHistoryRows(supabase, historyRows) {
  if (!historyRows?.length) return;

  const workingCodes = await loadWorkingStatusCodes(supabase);

  const rowsToCopy = historyRows.filter(
    (row) =>
      row.field_name === 'status' &&
      workingCodes.includes(row.new_value)
  );

  if (!rowsToCopy.length) return;

  const { error } = await supabase
    .from('okk_order_history_working')
    .upsert(rowsToCopy, { onConflict: 'id' });

  if (error) throw error;
}

export async function clearWorkingHistoryForOrder(supabase, orderId) {
  if (!orderId) return;

  const { error } = await supabase
    .from('okk_order_history_working')
    .delete()
    .eq('order_id', orderId);

  if (error) throw error;
}
