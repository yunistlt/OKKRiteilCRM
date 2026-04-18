import { supabase } from '@/utils/supabase';

type LegacyCallKind = 'incoming' | 'outgoing' | 'unknown';

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

export async function detectLegacyCallKind(callId: string): Promise<{
  kind: LegacyCallKind;
  incomingOrderId: number | null;
}> {
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