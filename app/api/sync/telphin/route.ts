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
// Normalization helper (Updated to strip 7/8 prefix for 10-digit standard)
function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
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

        // 2. TIMEOUT PROTECTION
        const TIMEOUT_MS = 55 * 1000; // Vercel limit is usually 10s (free) or 60s (pro). Let's be safe.
        const startTime = Date.now();

        // 3. TIME SLICING LOOP
        // We move in small chunks (e.g. 6 hours) to save progress frequently.
        const SLICE_HOURS = 6;
        const SLICE_MS = SLICE_HOURS * 60 * 60 * 1000;

        let cursorMs = startTs;
        let totalSynced = 0;

        console.log(`🔄 Starting Smart Sync. Window: ${start.toISOString()} -> ${now.toISOString()}`);

        while (cursorMs < nowTs) {
            // Check remaining time
            if (Date.now() - startTime > TIMEOUT_MS) {
                console.log('⚠️ Time limit reached. Stopping gracefully.');
                break;
            }

            let endSliceMs = cursorMs + SLICE_MS;
            if (endSliceMs > nowTs) endSliceMs = nowTs;

            const fromD = new Date(cursorMs);
            const toD = new Date(endSliceMs);

            console.log(`  ⏳ Processing Slice: ${formatTelphinDate(fromD)} -> ${formatTelphinDate(toD)}`);

            let sliceCalls: any[] = [];

            // Fetch ALL extensions for this slice
            // (Parallel execution)
            const BATCH_SIZE = 10;
            for (let i = 0; i < EXTENSIONS.length; i += BATCH_SIZE) {
                const chunkExts = EXTENSIONS.slice(i, i + BATCH_SIZE);
                const promises = chunkExts.map(extId => fetchChunk(extId, fromD, toD));
                const results = await Promise.all(promises);
                results.forEach(r => sliceCalls.push(...r));
            }

            // Upsert this slice
            if (sliceCalls.length > 0) {
                const rawCalls = sliceCalls.map((r: any) => {
                    const record_uuid = r.record_uuid || r.RecordUUID || `rec_${Math.random()}`;
                    const rawFlow = r.flow || r.direction;

                    let direction = 'unknown';
                    if (rawFlow === 'out') direction = 'outgoing';
                    else if (rawFlow === 'in') direction = 'incoming';
                    else if (rawFlow === 'incoming' || rawFlow === 'outgoing') direction = rawFlow;

                    const startedRaw = r.start_time_gmt || r.init_time_gmt;
                    const callDate = startedRaw ? new Date(startedRaw + 'Z') : new Date();

                    let fromNumber = r.from_number || r.ani_number;
                    let toNumber = r.to_number || r.dest_number;

                    // Specific mapping based on flow if needed, but generic fallback is usually ok for RAW
                    if (rawFlow === 'out') {
                        fromNumber = r.ani_number || r.from_number;
                        toNumber = r.dest_number || r.to_number;
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
                        recording_url: r.record_url || r.storage_url || r.url || null,
                        raw_payload: r,
                        ingested_at: new Date().toISOString()
                    };
                });

                const { error: rawError } = await supabase.from('raw_telphin_calls')
                    .upsert(rawCalls, { onConflict: 'telphin_call_id' });

                if (rawError) console.error('Slice Upsert Error:', rawError);
                else totalSynced += rawCalls.length;
            }

            // SAVE CHECKPOINT IMMEDIATELY
            // If we successfully processed this slice (or it was empty), we advance the cursor.
            // But we only verify "success" by lack of critical crashes. 

            // Advance cursor
            cursorMs = endSliceMs + 1000; // +1 sec to avoid overlap

            // Persist state
            await supabase.from('sync_state').upsert({
                key: storageKey,
                value: new Date(cursorMs).toISOString(),
                updated_at: new Date().toISOString()
            });
        }

        return NextResponse.json({
            success: true,
            total_synced: totalSynced,
            final_cursor: new Date(cursorMs).toISOString(),
            completed_fully: cursorMs >= nowTs,
            extensions_scanned: EXTENSIONS.length,
            debug_key_prefix: (process.env.TELPHIN_APP_KEY || '').substring(0, 5) + '...'
        });

    } catch (error: any) {
        console.error('Telphin Sync Error:', error);
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
