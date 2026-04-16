import { supabase } from '@/utils/supabase';

function buildLagSeconds(cursor: string | null) {
  if (!cursor) return null;
  const diffSeconds = Math.floor((Date.now() - new Date(cursor).getTime()) / 1000);
  return Math.max(0, diffSeconds);
}

export async function recordRetailCrmSyncSuccess(params: {
  cursorKey: 'retailcrm_orders_sync' | 'retailcrm_history_sync';
  successKey: 'retailcrm_orders_queue_last_success_at' | 'retailcrm_history_queue_last_success_at';
  lagKey: 'retailcrm_orders_lag_seconds' | 'retailcrm_history_lag_seconds';
  errorKey: 'retailcrm_orders_last_error' | 'retailcrm_history_last_error';
  cursorValue: string | null;
}) {
  const now = new Date().toISOString();
  const entries: Array<{ key: string; value: string; updated_at: string }> = [
    {
      key: params.successKey,
      value: now,
      updated_at: now,
    },
    {
      key: params.lagKey,
      value: String(buildLagSeconds(params.cursorValue) ?? 0),
      updated_at: now,
    },
    {
      key: params.errorKey,
      value: '',
      updated_at: now,
    },
  ];

  if (params.cursorValue) {
    entries.push({
      key: params.cursorKey,
      value: params.cursorValue,
      updated_at: now,
    });
  }

  const { error } = await supabase.from('sync_state').upsert(entries, { onConflict: 'key' });
  if (error) throw error;
}

export async function recordRetailCrmSyncFailure(params: {
  errorKey: 'retailcrm_orders_last_error' | 'retailcrm_history_last_error';
  message: string;
}) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('sync_state').upsert({
    key: params.errorKey,
    value: params.message.slice(0, 1500),
    updated_at: now,
  }, { onConflict: 'key' });

  if (error) throw error;
}