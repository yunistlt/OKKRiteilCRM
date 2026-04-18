import { supabase } from '@/utils/supabase';

const TELPHIN_LEGACY_COMPAT_OVERRIDE_KEY = 'telphin_legacy_compat_override';
const OVERRIDE_CACHE_TTL_MS = 5000;

type LegacyCallKind = 'incoming' | 'outgoing' | 'unknown';
type TelphinLegacyCompatOverride = 'inherit' | 'enabled' | 'disabled';

let overrideCache: {
  value: TelphinLegacyCompatOverride;
  updatedAt: string | null;
  expiresAt: number;
} | null = null;

interface LegacyIncomingInsertInput {
  callId: string;
  fromNumber: string;
  toNumber: string;
  matchedOrderId?: number | null;
  assignedManagerId?: number | null;
  status?: string | null;
  createdAt?: string | null;
}

interface LegacyStatusUpdateInput {
  callId: string;
  status?: string | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
}

interface LegacyRecordingUpdateInput {
  callId: string;
  recordingUrl: string;
}

function isMissingSyncStateRow(error: any) {
  return error?.code === 'PGRST116';
}

export function getDefaultTelphinLegacyCompatEnabled() {
  return process.env.ENABLE_TELPHIN_LEGACY_COMPAT !== 'false';
}

export function normalizeTelphinLegacyCompatOverride(value: unknown): TelphinLegacyCompatOverride {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'enabled' || normalized === 'true' || normalized === 'on') {
    return 'enabled';
  }

  if (normalized === 'disabled' || normalized === 'false' || normalized === 'off') {
    return 'disabled';
  }

  return 'inherit';
}

export async function getTelphinLegacyCompatOverrideState(forceRefresh = false) {
  if (!forceRefresh && overrideCache && overrideCache.expiresAt > Date.now()) {
    return {
      key: TELPHIN_LEGACY_COMPAT_OVERRIDE_KEY,
      value: overrideCache.value,
      updatedAt: overrideCache.updatedAt,
    };
  }

  const { data, error } = await supabase
    .from('sync_state')
    .select('value, updated_at')
    .eq('key', TELPHIN_LEGACY_COMPAT_OVERRIDE_KEY)
    .limit(1)
    .maybeSingle();

  if (error && !isMissingSyncStateRow(error)) {
    throw error;
  }

  const value = normalizeTelphinLegacyCompatOverride(data?.value);
  const updatedAt = data?.updated_at || null;

  overrideCache = {
    value,
    updatedAt,
    expiresAt: Date.now() + OVERRIDE_CACHE_TTL_MS,
  };

  return {
    key: TELPHIN_LEGACY_COMPAT_OVERRIDE_KEY,
    value,
    updatedAt,
  };
}

export async function isTelphinLegacyCompatEnabled() {
  const override = await getTelphinLegacyCompatOverrideState();

  if (override.value === 'enabled') {
    return true;
  }

  if (override.value === 'disabled') {
    return false;
  }

  return getDefaultTelphinLegacyCompatEnabled();
}

export async function getTelphinLegacyCompatRuntimeState(forceRefresh = false) {
  const defaultEnabled = getDefaultTelphinLegacyCompatEnabled();
  const override = await getTelphinLegacyCompatOverrideState(forceRefresh);

  return {
    key: TELPHIN_LEGACY_COMPAT_OVERRIDE_KEY,
    override: override.value,
    overrideUpdatedAt: override.updatedAt,
    defaultEnabled,
    effectiveEnabled: override.value === 'inherit' ? defaultEnabled : override.value === 'enabled',
  };
}

export async function detectLegacyCallKind(callId: string): Promise<{
  kind: LegacyCallKind;
  incomingOrderId: number | null;
}> {
  if (!(await isTelphinLegacyCompatEnabled())) {
    return {
      kind: 'unknown',
      incomingOrderId: null,
    };
  }

  try {
    const [outgoingResult, incomingResult] = await Promise.all([
      supabase
        .from('outgoing_calls')
        .select('id')
        .eq('call_sid', callId)
        .limit(1),
      supabase
        .from('incoming_calls')
        .select('id, order_id')
        .eq('call_sid', callId)
        .limit(1),
    ]);

    if (outgoingResult.error) {
      console.warn(`[TelphinLegacyCompat] Failed outgoing lookup for ${callId}:`, outgoingResult.error);
    }

    if (incomingResult.error) {
      console.warn(`[TelphinLegacyCompat] Failed incoming lookup for ${callId}:`, incomingResult.error);
    }

    const outgoing = outgoingResult.data?.[0];
    const incoming = incomingResult.data?.[0];

    if (outgoing) {
      return { kind: 'outgoing', incomingOrderId: null };
    }

    if (incoming) {
      return {
        kind: 'incoming',
        incomingOrderId: incoming.order_id ? Number(incoming.order_id) : null,
      };
    }
  } catch (error) {
    console.warn(`[TelphinLegacyCompat] Legacy lookup failed for ${callId}:`, error);
  }

  return {
    kind: 'unknown',
    incomingOrderId: null,
  };
}

export async function bestEffortInsertIncomingLegacyCall(input: LegacyIncomingInsertInput) {
  if (!(await isTelphinLegacyCompatEnabled())) {
    return;
  }

  try {
    const existing = await detectLegacyCallKind(input.callId);
    if (existing.kind === 'incoming') {
      const { error } = await supabase
        .from('incoming_calls')
        .update({
          from_number: input.fromNumber,
          to_number: input.toNumber,
          order_id: input.matchedOrderId ?? existing.incomingOrderId,
          assigned_manager_id: input.assignedManagerId ?? null,
          status: input.status || 'ringing',
        })
        .eq('call_sid', input.callId);

      if (error) {
        console.warn(`[TelphinLegacyCompat] Failed to update existing incoming call ${input.callId}:`, error);
      }
      return;
    }

    const { error } = await supabase
      .from('incoming_calls')
      .insert({
        call_sid: input.callId,
        from_number: input.fromNumber,
        to_number: input.toNumber,
        order_id: input.matchedOrderId ?? null,
        assigned_manager_id: input.assignedManagerId ?? null,
        status: input.status || 'ringing',
        created_at: input.createdAt || new Date().toISOString(),
      });

    if (error) {
      console.warn(`[TelphinLegacyCompat] Failed to insert incoming call ${input.callId}:`, error);
    }
  } catch (error) {
    console.warn(`[TelphinLegacyCompat] Incoming compat sync failed for ${input.callId}:`, error);
  }
}

export async function bestEffortUpdateLegacyCallStatus(input: LegacyStatusUpdateInput) {
  if (!(await isTelphinLegacyCompatEnabled())) {
    return;
  }

  try {
    const lookup = await detectLegacyCallKind(input.callId);
    const updatePayload = {
      status: input.status || null,
      duration_seconds: input.durationSeconds ?? null,
      recording_url: input.recordingUrl || null,
      answered_at: input.answeredAt || null,
      ended_at: input.endedAt || null,
    };

    if (lookup.kind === 'outgoing') {
      const { error } = await supabase
        .from('outgoing_calls')
        .update(updatePayload)
        .eq('call_sid', input.callId);

      if (error) {
        console.warn(`[TelphinLegacyCompat] Failed to update outgoing call ${input.callId}:`, error);
      }
      return;
    }

    if (lookup.kind === 'incoming') {
      const { error } = await supabase
        .from('incoming_calls')
        .update(updatePayload)
        .eq('call_sid', input.callId);

      if (error) {
        console.warn(`[TelphinLegacyCompat] Failed to update incoming call ${input.callId}:`, error);
      }
    }
  } catch (error) {
    console.warn(`[TelphinLegacyCompat] Status compat sync failed for ${input.callId}:`, error);
  }
}

export async function bestEffortUpdateLegacyCallRecording(input: LegacyRecordingUpdateInput) {
  if (!(await isTelphinLegacyCompatEnabled())) {
    return;
  }

  try {
    const lookup = await detectLegacyCallKind(input.callId);

    if (lookup.kind === 'outgoing') {
      const { error } = await supabase
        .from('outgoing_calls')
        .update({
          recording_url: input.recordingUrl,
        })
        .eq('call_sid', input.callId);

      if (error) {
        console.warn(`[TelphinLegacyCompat] Failed to update outgoing recording ${input.callId}:`, error);
      }
      return;
    }

    if (lookup.kind === 'incoming') {
      const { error } = await supabase
        .from('incoming_calls')
        .update({
          recording_url: input.recordingUrl,
        })
        .eq('call_sid', input.callId);

      if (error) {
        console.warn(`[TelphinLegacyCompat] Failed to update incoming recording ${input.callId}:`, error);
      }
    }
  } catch (error) {
    console.warn(`[TelphinLegacyCompat] Recording compat sync failed for ${input.callId}:`, error);
  }
}