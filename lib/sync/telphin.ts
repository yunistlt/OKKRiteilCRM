import { supabase } from '@/utils/supabase';
import { fetchTelphin, getTelphinToken } from '@/lib/telphin';
import { safeEnqueueCallTranscriptionJob, safeEnqueueSystemJob } from '@/lib/system-jobs';

// Helper to format date for Telphin: YYYY-MM-DD HH:mm:ss
function formatTelphinDate(date: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        date.getUTCFullYear() + '-' +
        pad(date.getUTCMonth() + 1) + '-' +
        pad(date.getUTCDate()) + ' ' +
        pad(date.getUTCHours()) + ':' +
        pad(date.getUTCMinutes()) + ':' +
        pad(date.getUTCSeconds())
    );
}

// Normalization helper (Updated to strip 7/8 prefix for 10-digit standard)
function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

export interface SyncResult {
    success: boolean;
    total_synced?: number;
    new_cursor?: string;
    mode?: string;
    rule_engine_violations?: any;
    error?: string;
}

function getDefaultTelphinFallbackMinutes() {
    const parsed = Number.parseInt(process.env.TELPHIN_FALLBACK_MINUTES || '15', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 15;
    }
    return parsed;
}

async function recordTelphinFallbackSuccess(cursor: string) {
    const now = new Date().toISOString();
    const lagSeconds = Math.max(0, Math.floor((Date.now() - new Date(cursor).getTime()) / 1000));

    const { error } = await supabase.from('sync_state').upsert([
        {
            key: 'telphin_last_sync_time',
            value: cursor,
            updated_at: now,
        },
        {
            key: 'telphin_fallback_lag_seconds',
            value: String(lagSeconds),
            updated_at: now,
        },
        {
            key: 'telphin_fallback_last_error',
            value: '',
            updated_at: now,
        },
    ], { onConflict: 'key' });

    if (error) throw error;
}

async function recordTelphinFallbackFailure(message: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('sync_state').upsert({
        key: 'telphin_fallback_last_error',
        value: message.slice(0, 1500),
        updated_at: now,
    }, { onConflict: 'key' });

    if (error) throw error;
}

export async function runTelphinSync(forceResync: boolean = false, hours: number = 2): Promise<SyncResult> {
    const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
    const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

    if (!TELPHIN_APP_KEY || !TELPHIN_APP_SECRET) {
        return { success: false, error: 'Telphin config missing' };
    }

    try {
        const token = await getTelphinToken();
        const now = new Date();
        const storageKey = 'telphin_last_sync_time';
        const defaultFallbackMinutes = getDefaultTelphinFallbackMinutes();
        const maxLookbackMs = defaultFallbackMinutes * 60 * 1000;

        // 1. Get Start Date from Persistent Cursor (Sync State)
        let start = new Date(Date.now() - maxLookbackMs);

        if (!forceResync) {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', storageKey)
                .single();

            if (state?.value) {
                // Ensure the cursor isn't in the future
                const storedDate = new Date(state.value);
                if (storedDate < now) {
                    const boundedStart = new Date(Math.max(storedDate.getTime(), now.getTime() - maxLookbackMs));
                    start = boundedStart;
                    console.log('Incremental sync from state:', start.toISOString());
                } else {
                    console.warn('Stored cursor is in the future, falling back to default window.', state.value);
                }
            }
        } else {
            console.log(`Forced resync requested. Looking back ${hours} hours.`);
            start = new Date(Date.now() - hours * 60 * 60 * 1000);
        }

        // 2. Get Client ID
        const userRes = await fetchTelphin('https://apiproxy.telphin.ru/api/ver1.0/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!userRes.ok) {
            const text = await userRes.text();
            throw new Error(`Telphin user lookup failed: ${userRes.status} ${text.substring(0, 200)}`);
        }
        const userData = await userRes.json();
        const clientId = userData.client_id;
        if (!clientId) throw new Error('Could not resolve Telphin Client ID');

        // 3. Fetch Calls via call_history (Account-wide)
        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(start),
            end_datetime: formatTelphinDate(now),
            order: 'asc',
            count: '100' // Main sync can afford larger batches than backfill
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params.toString()}`;
        console.log(`[Sync] Fetching ${url}`);

        const res = await fetchTelphin(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Telphin API Error ${res.status}: ${text.substring(0, 200) || res.statusText}`);
        }

        const data = await res.json();
        const calls = data.call_history || (Array.isArray(data) ? data : []);
        console.log(`[Sync] Fetched ${calls.length} calls.`);

        let totalSynced = 0;
        let nextCursor = start.toISOString();
        let fetchedCount = calls.length;

        if (calls.length > 0) {
            const rawCalls = calls.map((r: any) => {
                const record_uuid = r.call_uuid || r.record_uuid || `rec_${Math.random()}`;
                const rawFlow = r.flow || r.direction;

                let direction = 'unknown';
                if (rawFlow === 'out') direction = 'outgoing';
                else if (rawFlow === 'in') direction = 'incoming';
                else if (rawFlow === 'incoming' || rawFlow === 'outgoing') direction = rawFlow;

                const startedRaw = r.start_time_gmt || r.init_time_gmt || r.bridged_time_gmt;
                const callDate = startedRaw ? new Date(startedRaw + (startedRaw.includes('Z') ? '' : 'Z')) : new Date();

                let fromNumber = r.from_number || r.ani_number || r.from_username;
                let toNumber = r.to_number || r.dest_number || r.to_username;

                if (rawFlow === 'out') {
                    fromNumber = r.ani_number || r.from_number || r.from_username;
                    toNumber = r.dest_number || r.to_number || r.to_username;
                }

                // Extract recording URL from nested CDR array if available
                let recordingUrl = r.record_url || r.storage_url || r.url || null;
                if (!recordingUrl && r.cdr && Array.isArray(r.cdr)) {
                    // Find the first CDR with a storage_url
                    const cdrWithStorage = r.cdr.find((c: any) => c.storage_url);
                    if (cdrWithStorage) {
                        recordingUrl = cdrWithStorage.storage_url;
                    }
                }

                return {
                    telphin_call_id: record_uuid,
                    direction: direction,
                    from_number: fromNumber || 'unknown',
                    to_number: toNumber || 'unknown',
                    from_number_normalized: normalizePhone(fromNumber),
                    to_number_normalized: normalizePhone(toNumber),
                    started_at: callDate.toISOString(),
                    duration_sec: r.duration || 0,
                    recording_url: recordingUrl,
                    raw_payload: r,
                    ingested_at: new Date().toISOString()
                };
            });

            const { error: rawError } = await supabase.from('raw_telphin_calls')
                .upsert(rawCalls, { onConflict: 'telphin_call_id' });

            if (rawError) {
                console.error('[Sync] Upsert Error:', rawError);
                throw rawError;
            }

            totalSynced = rawCalls.length;

            for (const rawCall of rawCalls) {
                await safeEnqueueSystemJob({
                    jobType: 'call_match',
                    payload: {
                        telphin_call_id: rawCall.telphin_call_id,
                        source: 'telphin_fallback_sync',
                        started_at: rawCall.started_at,
                    },
                    priority: 30,
                    idempotencyKey: `call_match:${rawCall.telphin_call_id}:telphin_fallback`,
                });

                if (rawCall.recording_url) {
                    await safeEnqueueCallTranscriptionJob({
                        callId: rawCall.telphin_call_id,
                        source: 'telphin_fallback_sync',
                        recordingUrl: rawCall.recording_url,
                        startedAt: rawCall.started_at,
                        payload: {
                            recording_ready_at: new Date().toISOString(),
                        },
                    });
                }
            }

            // Advance cursor to the last record's time
            const lastCall = calls[calls.length - 1];
            const lastTimeRaw = lastCall.start_time_gmt || lastCall.init_time_gmt || lastCall.bridged_time_gmt;
            const lastDate = new Date(lastTimeRaw + (lastTimeRaw.includes('Z') ? '' : 'Z'));
            nextCursor = lastDate.toISOString();
        } else {
            // If No calls, we can advance to Now to keep it fresh
            nextCursor = now.toISOString();
        }

        // 4. Update Cursor
        await recordTelphinFallbackSuccess(nextCursor);

        // 5. Trigger Rule Engine Analysis
        return {
            success: true,
            total_synced: totalSynced,
            new_cursor: nextCursor,
            mode: forceResync ? 'forced_resync' : (fetchedCount === 100 ? 'fallback_partial' : 'fallback_caught_up')
        };

    } catch (error: any) {
        console.error('Telphin Sync Logic Error:', error);
        await recordTelphinFallbackFailure(error.message || 'Unknown Telphin fallback sync error');
        return { success: false, error: error.message };
    }
}
