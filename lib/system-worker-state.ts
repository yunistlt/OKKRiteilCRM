import { supabase } from '@/utils/supabase';

function truncateErrorMessage(message: string) {
  return message.slice(0, 1500);
}

export async function recordWorkerSuccess(workerKey: string, metadata?: Record<string, any>) {
  const now = new Date().toISOString();
  const entries = [
    {
      key: `${workerKey}.last_success_at`,
      value: now,
      updated_at: now,
    },
    {
      key: `${workerKey}.last_error`,
      value: '',
      updated_at: now,
    },
  ];

  if (metadata) {
    entries.push({
      key: `${workerKey}.last_success_meta`,
      value: JSON.stringify(metadata),
      updated_at: now,
    });
  }

  const { error } = await supabase.from('sync_state').upsert(entries, { onConflict: 'key' });
  if (error) throw error;
}

export async function recordWorkerFailure(workerKey: string, errorMessage: string, metadata?: Record<string, any>) {
  const now = new Date().toISOString();
  const entries = [
    {
      key: `${workerKey}.last_error_at`,
      value: now,
      updated_at: now,
    },
    {
      key: `${workerKey}.last_error`,
      value: truncateErrorMessage(errorMessage),
      updated_at: now,
    },
  ];

  if (metadata) {
    entries.push({
      key: `${workerKey}.last_error_meta`,
      value: JSON.stringify(metadata),
      updated_at: now,
    });
  }

  const { error } = await supabase.from('sync_state').upsert(entries, { onConflict: 'key' });
  if (error) throw error;
}