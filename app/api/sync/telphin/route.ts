import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';

// Hardcoded extensions list from user snippet (proven to work)
const EXTENSIONS = [
    94413, 94415, 145748, 349957, 349963, 351106, 469589,
    533987, 555997, 562946, 643886, 660848, 669428, 718843,
    765119, 768698, 775235, 775238, 805250, 809876, 813743,
    828290, 839939, 855176, 858926, 858929, 858932, 858935,
    911927, 946706, 968099, 969008, 982610, 995756, 1015712,
];

// Helper to format date for Telphin: YYYY-MM-DD HH:mm:ss
function formatTelphinDate(date: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        ' ' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes()) +
        ':' +
        pad(date.getSeconds())
    );
}

// Normalization helper
function normalizePhone(val: any) {
    if (!val) return null;
    return String(val).replace(/[^\d+]/g, '');
}

const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
    if (!TELPHIN_APP_KEY || !TELPHIN_APP_SECRET) {
        return NextResponse.json({ error: 'Telphin config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const forceResync = searchParams.get('force') === 'true';

        const token = await getTelphinToken();
        const now = new Date();
        const storageKey = 'telphin_last_sync_time';

        // 1. Get Start Date from Persistent Cursor (Sync State)
        let start = new Date('2025-09-01T00:00:00Z'); // Default set to Sept 1, 2025 per user request

        if (!forceResync) {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', storageKey)
                .single();

            if (state?.value) {
                start = new Date(state.value);
                console.log('Incremental sync from state:', start.toISOString());
            } else {
                console.log('No state found, starting from default:', start.toISOString());
            }
        } else {
            // Check if user provided specific start date via query param
            const queryStart = searchParams.get('start_date');
            if (queryStart) {
                start = new Date(queryStart);
                console.log('Force sync requested from custom date:', start.toISOString());
            } else {
                console.log('Force/Full sync requested, starting from default:', start.toISOString());
            }
        }

        const nowTs = now.getTime();
        const startTs = start.getTime();

        // Helper to fetch one chunk
        const fetchChunk = async (extId: number, fromD: Date, toD: Date) => {
            const params = new URLSearchParams({
                start_datetime: formatTelphinDate(fromD),
                end_datetime: formatTelphinDate(toD),
                order: 'asc',
            });
            const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;
            if (!debugLastUrl) debugLastUrl = url;

            try {
                const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
                if (!res.ok) {
                    console.error(`Fetch failed for ext ${extId}: ${res.status} ${res.statusText}`);
                    return [];
                }
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (e) {
                console.error(`Fetch error for ext ${extId}:`, e);
                return [];
            }
        };

        let allCalls: any[] = [];
        let debugLastUrl = '';

        // Chunking Logic (Split time range into < 1 month chunks)
        // Telphin limit is ~2 months, we use 30 days to be safe.
        const CHUNK_MS = 30 * 24 * 60 * 60 * 1000;

        // Fetch loop over extensions (using Parallel Batches)
        const fetchExtensionRecords = async (extId: number) => {
            let records: any[] = [];
            let cursor = startTs;

            while (cursor < nowTs) {
                let endChunk = cursor + CHUNK_MS;
                if (endChunk > nowTs) endChunk = nowTs;

                const fromD = new Date(cursor);
                const toD = new Date(endChunk);

                // Fetch this chunk
                const chunkData = await fetchChunk(extId, fromD, toD);
                records.push(...chunkData);

                cursor = endChunk + 1000; // Advance by 1 sec to avoid overlap? Or just accept slight overlap.
                // Telphin range is inclusive? "start_datetime" usually inclusive.
                // Ideally we add 1ms or just use same end as next start if precise.
                // Let's use exact boundaries.
            }
            return records;
        };

        const BATCH_SIZE = 5;
        for (let i = 0; i < EXTENSIONS.length; i += BATCH_SIZE) {
            const chunk = EXTENSIONS.slice(i, i + BATCH_SIZE);
            const promises = chunk.map(id => fetchExtensionRecords(id));
            const results = await Promise.all(promises);
            results.forEach(records => allCalls.push(...records));
        }

        console.log(`Fetched ${allCalls.length} records.`);

        // Process and map to database schema
        const mappedCalls = allCalls.map((r: any) => {
            const record_uuid = r.record_uuid || r.RecordUUID || `rec_${Math.random()}`;
            const flow = r.flow || r.direction;
            const startedRaw = r.start_time_gmt || r.init_time_gmt;

            let fromNumber = null;
            let toNumber = null;

            if (flow === 'out') {
                fromNumber = r.ani_number || r.from_number;
                toNumber = r.dest_number || r.to_number;
            } else if (flow === 'in') {
                fromNumber = r.ani_number || r.from_number;
                toNumber = r.dest_number || r.to_number;
            } else {
                fromNumber = r.from_number || r.ani_number;
                toNumber = r.to_number || r.dest_number;
            }

            const fromNorm = normalizePhone(fromNumber);
            const toNorm = normalizePhone(toNumber);
            const callDate = startedRaw ? new Date(startedRaw + 'Z') : new Date();

            return {
                id: record_uuid, // using record_uuid as primary ID
                driver_number: fromNorm,
                client_number: toNorm,
                duration: r.duration || 0,
                status: r.result || r.call_status || r.hangup_cause || 'unknown',
                manager_id: String(r.extension_id || 'unknown'),
                timestamp: callDate.toISOString(),
                record_url: r.record_url || r.storage_url || r.url || null,
                raw_data: r
            };
        });

        if (mappedCalls.length > 0) {
            // 1. Legacy Write REMOVED
            // We fully transitioned to RAW layer.

            // 2. RAW Layer Write (raw_telphin_calls)
            // Map legacy structure to RAW structure
            const rawCalls = mappedCalls.map(c => ({
                telphin_call_id: c.id,
                direction: c.raw_data.flow || c.raw_data.direction || 'unknown',
                from_number: c.raw_data.from_number || c.raw_data.ani_number || 'unknown',
                to_number: c.raw_data.to_number || c.raw_data.dest_number || 'unknown',
                from_number_normalized: c.driver_number,
                to_number_normalized: c.client_number,
                started_at: c.timestamp,
                duration_sec: c.duration,
                recording_url: c.record_url,
                raw_payload: c.raw_data,
                ingested_at: new Date().toISOString()
            }));

            const { error: rawError } = await supabase.from('raw_telphin_calls')
                .upsert(rawCalls, { onConflict: 'telphin_call_id' });

            if (rawError) {
                console.error('Supabase Upsert Error (RAW):', rawError);
            }
        }

        // Save Cursor (Current 'NOW' becomes next start time)
        if (mappedCalls.length > 0) {
            await supabase.from('sync_state').upsert({
                key: storageKey,
                value: now.toISOString(),
                updated_at: new Date().toISOString()
            });
        }

        return NextResponse.json({
            success: true,
            count: mappedCalls.length,
            extensions_scanned: EXTENSIONS.length,
            debug_sample: mappedCalls[0],
            debug_last_url: debugLastUrl,
            time_window: { from: start.toISOString(), to: now.toISOString() }
        });

    } catch (error: any) {
        console.error('Telphin Sync Error:', error);
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
