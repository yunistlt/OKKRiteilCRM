import { supabase } from '@/utils/supabase';

export async function tryAcquireRuntimeSyncLock(params: {
  lockKey: string;
  holder: string;
  ttlSeconds?: number;
}) {
  const { data, error } = await supabase.rpc('try_acquire_runtime_sync_lock', {
    p_lock_key: params.lockKey,
    p_holder: params.holder,
    p_ttl_seconds: params.ttlSeconds ?? 300,
  });

  if (error) throw error;
  return Boolean(data);
}

export async function releaseRuntimeSyncLock(params: {
  lockKey: string;
  holder: string;
}) {
  const { data, error } = await supabase.rpc('release_runtime_sync_lock', {
    p_lock_key: params.lockKey,
    p_holder: params.holder,
  });

  if (error) throw error;
  return Boolean(data);
}