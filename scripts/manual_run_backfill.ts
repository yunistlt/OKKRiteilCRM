
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

// --- CONFIG ---
const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

const EXTENSIONS = [
    94413, 94415, 145748, 349957, 349963, 351106, 469589,
    533987, 555997, 562946, 643886, 660848, 669428, 718843,
    765119, 768698, 775235, 775238, 805250, 809876, 813743,
    828290, 839939, 855176, 858926, 858929, 858932, 858935,
    911927, 946706, 968099, 969008, 982610, 995756, 1015712,
];

// --- HELPERS ---
async function getTelphinToken() {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', TELPHIN_APP_KEY || '');
    params.append('client_secret', TELPHIN_APP_SECRET || '');
    params.append('scope', 'all');

    const res = await fetch('https://apiproxy.telphin.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });
    const data = await res.json();
    return data.access_token;
}

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

function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

// --- MAIN LOOP ---
async function runLoop() {
    console.log('=== MANUAL BACKFILL RUNNER (Target: Nov 24-29 - 5-DAY Window) ===');
    console.log('=== MODE: Sequential + Retry + 2s Delay ===');

    // Initial Count
    const { count: startCount } = await supabase.from('raw_telphin_calls').select('*', { count: 'exact', head: true });
    console.log(`Initial DB Count: ${startCount}`);

    // Fast Forward to busy period
    const TARGET_DATE = '2025-11-24T00:00:00Z';
    console.log(`\nStarting from: ${TARGET_DATE}`);

    const iterations = 1; // Run 1 BIG slice
    let currentCursor = new Date(TARGET_DATE);

    for (let i = 0; i < iterations; i++) {
        console.log(`\n--- Iteration ${i + 1}/${iterations} ---`);
        currentCursor = await processOneSlice(currentCursor);
    }

    // Check newly ingested
    const ago = new Date(Date.now() - 60000).toISOString(); // last minute
    const { count: freshCount } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .gte('ingested_at', ago);

    console.log(`\nTotal Records Ingested/Updated in last minute: ${freshCount}`);

    // Final Count
    const { count: endCount } = await supabase.from('raw_telphin_calls').select('*', { count: 'exact', head: true });
    console.log(`Final DB Count: ${endCount}`);
    console.log(`Growth (Net New): +${(endCount || 0) - (startCount || 0)} calls`);
}

async function processOneSlice(cursorOverride: Date) {
    const token = await getTelphinToken();

    // 2. Define Slice (5 DAYS)
    const SLICE_MS = 5 * 24 * 60 * 60 * 1000;
    let endSliceMs = cursorOverride.getTime() + SLICE_MS;

    const fromD = cursorOverride;
    const toD = new Date(endSliceMs);

    console.log(`Processing: ${formatTelphinDate(fromD)} -> ${formatTelphinDate(toD)}`);

    // 3. Fetch with Retry Logic
    const fetchChunk = async (extId: number) => {
        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(fromD),
            end_datetime: formatTelphinDate(toD),
            order: 'asc',
            count: '1000'
        });
        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;

        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

                if (res.status === 429) {
                    const wait = attempt * 3000; // 3s, 6s, 9s backoff
                    console.log(`⚠️  Ext ${extId}: 429 Hit. Waiting ${wait}ms (Attempt ${attempt}/${MAX_RETRIES})`);
                    await new Promise(r => setTimeout(r, wait));
                    continue; // Retry loop
                }

                if (!res.ok) {
                    console.error(`ERROR Ext ${extId}: Status ${res.status}`);
                    return [];
                }

                const data = await res.json();
                const count = Array.isArray(data) ? data.length : 0;
                if (count > 0) console.log(`   ✅ Ext ${extId}: ${count} calls`);
                return Array.isArray(data) ? data : [];

            } catch (e) {
                console.error(`EXCEPTION Ext ${extId}:`, e);
                return [];
            }
        }
        return []; // Failed after retries
    };

    let sliceCalls: any[] = [];

    // SEQUENTIAL LOOP
    for (const extId of EXTENSIONS) {
        const calls = await fetchChunk(extId);
        sliceCalls.push(...calls);

        // Polite Delay even on success to prevent subsequent 429s
        await new Promise(r => setTimeout(r, 2000));
    }


    console.log(`Found ${sliceCalls.length} calls in slice.`);

    // 4. Upsert
    if (sliceCalls.length > 0) {
        const rawCalls = sliceCalls.map((r: any) => {
            const startedRaw = r.start_time_gmt || r.init_time_gmt;
            const callDate = startedRaw ? new Date(startedRaw + 'Z') : new Date();
            return {
                telphin_call_id: r.record_uuid || r.RecordUUID || `rec_${Math.random()}`,
                direction: 'manual_sync_v5_retry',
                from_number: r.from_number || r.ani_number || 'unknown',
                to_number: r.to_number || r.dest_number || 'unknown',
                from_number_normalized: normalizePhone(r.from_number || r.ani_number),
                to_number_normalized: normalizePhone(r.to_number || r.dest_number),
                started_at: callDate.toISOString(),
                raw_payload: r,
                ingested_at: new Date().toISOString()
            };
        });

        await supabase.from('raw_telphin_calls').upsert(rawCalls, { onConflict: 'telphin_call_id' });
    }

    return new Date(endSliceMs);
}

runLoop().catch(console.error);
