import { normalizePhone } from './phone-utils';
import { supabase } from '@/utils/supabase';
import { loadLegacyCallContext } from './telphin-legacy-compat';

type CallDirection = 'incoming' | 'outgoing';

interface CanonicalWebhookSyncInput {
  callId: string;
  payload: Record<string, any>;
  direction?: CallDirection;
  fromNumber?: string | null;
  toNumber?: string | null;
  startedAt?: string | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  status?: string | null;
  queueForTranscription?: boolean;
  syncSource?: string;
}

function inferDirection(payload: Record<string, any>): CallDirection {
  const rawDirection = String(
    payload.direction || payload.flow || payload.call_direction || ''
  ).toLowerCase();

  if (rawDirection === 'out' || rawDirection === 'outgoing') {
    return 'outgoing';
  }

  return 'incoming';
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function createEmptyLegacyContext() {
  return {
    direction: 'unknown' as const,
    fromNumber: null,
    toNumber: null,
    startedAt: null,
    durationSeconds: null,
    recordingUrl: null,
    status: null,
  };
}


export async function upsertCanonicalTelphinCall(
  input: CanonicalWebhookSyncInput
) {
  const existingResult = await supabase
    .from('raw_telphin_calls')
    .select('telphin_call_id, direction, from_number, to_number, started_at, duration_sec, recording_url, raw_payload, transcription_status, transcript')
    .eq('telphin_call_id', input.callId)
    .limit(1);

  const existing = existingResult.data?.[0] || null;
  const needsLegacyContext =
    !existing ||
    (!input.direction && !existing.direction) ||
    (!input.fromNumber && !existing.from_number) ||
    (!input.toNumber && !existing.to_number) ||
    (!input.startedAt && !existing.started_at) ||
    (input.durationSeconds === undefined && existing?.duration_sec === null) ||
    (!input.recordingUrl && !input.payload.recording_url && !existing.recording_url) ||
    (!input.status && !input.payload.status);

  const legacy = needsLegacyContext
    ? await loadLegacyCallContext(input.callId)
    : createEmptyLegacyContext();

  const direction =
    input.direction ||
    existing?.direction ||
    legacy.direction ||
    inferDirection(input.payload);

  const fromNumber =
    input.fromNumber ||
    existing?.from_number ||
    legacy.fromNumber ||
    input.payload.from_number ||
    input.payload.ani_number ||
    input.payload.from ||
    'unknown';

  const toNumber =
    input.toNumber ||
    existing?.to_number ||
    legacy.toNumber ||
    input.payload.to_number ||
    input.payload.dest_number ||
    input.payload.to ||
    'unknown';

  const startedAt =
    toIsoOrNull(input.startedAt || null) ||
    existing?.started_at ||
    toIsoOrNull(legacy.startedAt) ||
    toIsoOrNull(input.payload.started_at) ||
    toIsoOrNull(input.payload.timestamp) ||
    new Date().toISOString();

  const durationSec =
    input.durationSeconds ??
    input.payload.duration_seconds ??
    input.payload.duration ??
    existing?.duration_sec ??
    legacy.durationSeconds ??
    null;

  const recordingUrl =
    input.recordingUrl ||
    input.payload.recording_url ||
    existing?.recording_url ||
    legacy.recordingUrl ||
    null;

  const status =
    input.status || input.payload.status || legacy.status || null;

  const previousPayload =
    existing?.raw_payload && typeof existing.raw_payload === 'object' && !Array.isArray(existing.raw_payload)
      ? existing.raw_payload
      : {};

  const rawPayload = {
    ...previousPayload,
    ...input.payload,
    status: status || previousPayload.status || null,
    recording_url: recordingUrl || previousPayload.recording_url || null,
    duration_seconds: durationSec ?? previousPayload.duration_seconds ?? null,
    _sync_source: input.syncSource || 'telphin_runtime',
    _recording_ready_at:
      previousPayload._recording_ready_at ||
      (input.queueForTranscription && recordingUrl
        ? toIsoOrNull(String(input.payload.recording_ready_at || input.payload.ended_at || input.payload.timestamp || input.startedAt || '')) || new Date().toISOString()
        : null),
    _canonical_updated_at: new Date().toISOString(),
  };

  const upsertPayload: Record<string, any> = {
    telphin_call_id: input.callId,
    direction,
    from_number: String(fromNumber),
    to_number: String(toNumber),
    from_number_normalized: normalizePhone(String(fromNumber)),
    to_number_normalized: normalizePhone(String(toNumber)),
    started_at: startedAt,
    duration_sec: durationSec,
    recording_url: recordingUrl,
    raw_payload: rawPayload,
    ingested_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from('raw_telphin_calls')
    .upsert(upsertPayload, { onConflict: 'telphin_call_id' });

  if (upsertError) {
    throw upsertError;
  }

  const shouldQueueTranscription =
    Boolean(input.queueForTranscription && recordingUrl) &&
    !existing?.transcript &&
    existing?.transcription_status !== 'completed' &&
    existing?.transcription_status !== 'processing' &&
    existing?.transcription_status !== 'ready_for_transcription';

  if (shouldQueueTranscription) {
    const { error: queueError } = await supabase
      .from('raw_telphin_calls')
      .update({
        recording_url: recordingUrl,
        transcription_status: 'ready_for_transcription',
      })
      .eq('telphin_call_id', input.callId);

    if (queueError) {
      throw queueError;
    }
  }

  return {
    direction,
    startedAt,
    queuedForTranscription: shouldQueueTranscription,
  };
}

export async function syncCanonicalTelphinCallFromWebhook(
  input: CanonicalWebhookSyncInput
) {
  return upsertCanonicalTelphinCall({
    ...input,
    syncSource: input.syncSource || 'telphin_webhook',
  });
}