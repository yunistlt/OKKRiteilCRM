import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';

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

        // 1. Get Start Date from Persistent Cursor (Sync State)
        let start = new Date(Date.now() - hours * 60 * 60 * 1000); // Default to N hours ago

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
                    start = storedDate;
                    console.log('Incremental sync from state:', start.toISOString());
                } else {
                    console.warn('Stored cursor is in the future, falling back to default window.', state.value);
                }
            }
        } else {
            console.log(`Forced resync requested. Looking back ${hours} hours.`);
        }

        // 2. Get Client ID
        const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
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

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            throw new Error(`Telphin API Error: ${res.status} ${res.statusText}`);
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
        await supabase.from('sync_state').upsert({
            key: storageKey,
            value: nextCursor,
            updated_at: new Date().toISOString()
        }, { onConflict: 'key' });

        // 5. Trigger Rule Engine Analysis
        return {
            success: true,
            total_synced: totalSynced,
            new_cursor: nextCursor,
            mode: fetchedCount === 100 ? 'partial (more data likely)' : 'caught up'
        };

    } catch (error: any) {
        console.error('Telphin Sync Logic Error:', error);
        return { success: false, error: error.message };
    }
}
