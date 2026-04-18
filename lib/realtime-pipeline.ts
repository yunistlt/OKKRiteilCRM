import { supabase } from '@/utils/supabase';

const REALTIME_PIPELINE_OVERRIDE_KEY = 'realtime_pipeline_override';
const OVERRIDE_CACHE_TTL_MS = 5000;

type RealtimePipelineOverride = 'inherit' | 'enabled' | 'disabled';

let overrideCache: {
  value: RealtimePipelineOverride;
  updatedAt: string | null;
  expiresAt: number;
} | null = null;

function isMissingSyncStateRow(error: any) {
  return error?.code === 'PGRST116';
}

export function getDefaultRealtimePipelineEnabled() {
  return process.env.ENABLE_SYSTEM_JOBS_PIPELINE === 'true';
}

export function normalizeRealtimePipelineOverride(value: unknown): RealtimePipelineOverride {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'enabled' || normalized === 'true' || normalized === 'on') {
    return 'enabled';
  }

  if (normalized === 'disabled' || normalized === 'false' || normalized === 'off') {
    return 'disabled';
  }

  return 'inherit';
}

export async function getRealtimePipelineOverrideState(forceRefresh = false) {
  if (!forceRefresh && overrideCache && overrideCache.expiresAt > Date.now()) {
    return {
      key: REALTIME_PIPELINE_OVERRIDE_KEY,
      value: overrideCache.value,
      updatedAt: overrideCache.updatedAt,
    };
  }

  const { data, error } = await supabase
    .from('sync_state')
    .select('value, updated_at')
    .eq('key', REALTIME_PIPELINE_OVERRIDE_KEY)
    .limit(1)
    .maybeSingle();

  if (error && !isMissingSyncStateRow(error)) {
    throw error;
  }

  const value = normalizeRealtimePipelineOverride(data?.value);
  const updatedAt = data?.updated_at || null;

  overrideCache = {
    value,
    updatedAt,
    expiresAt: Date.now() + OVERRIDE_CACHE_TTL_MS,
  };

  return {
    key: REALTIME_PIPELINE_OVERRIDE_KEY,
    value,
    updatedAt,
  };
}

export async function isRealtimePipelineEnabled() {
  const override = await getRealtimePipelineOverrideState();

  if (override.value === 'enabled') {
    return true;
  }

  if (override.value === 'disabled') {
    return false;
  }

  return getDefaultRealtimePipelineEnabled();
}

export async function getRealtimePipelineRuntimeState(forceRefresh = false) {
  const defaultEnabled = getDefaultRealtimePipelineEnabled();
  const override = await getRealtimePipelineOverrideState(forceRefresh);
  const effectiveEnabled = override.value === 'inherit'
    ? defaultEnabled
    : override.value === 'enabled';

  return {
    key: REALTIME_PIPELINE_OVERRIDE_KEY,
    override: override.value,
    overrideUpdatedAt: override.updatedAt,
    defaultEnabled,
    effectiveEnabled,
  };
}