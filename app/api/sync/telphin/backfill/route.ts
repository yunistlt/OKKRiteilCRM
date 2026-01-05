
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const EXTENSIONS = [
    94413, 94415, 145748, 349957, 349963, 351106, 469589,
    533987, 555997, 562946, 643886, 660848, 669428, 718843,
    765119, 768698, 775235, 775238, 805250, 809876, 813743,
    828290, 839939, 855176, 858926, 858929, 858932, 858935,
    911927, 946706, 968099, 969008, 982610, 995756, 1015712,
];

function formatTelphinDate(date: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    // Use UTC to ensure Vercel/Local consistency
    return (
        date.getUTCFullYear() +
        '-' +
        pad(date.getUTCMonth() + 1) +
        '-' +
        pad(date.getUTCDate()) +
        ' ' +
        pad(date.getUTCHours()) +
        ':' +
        pad(date.getUTCMinutes()) +
        ':' +
        pad(date.getUTCSeconds())
    );
}

const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    // Standardize to 10 digits if 11 and starts with 7 or 8
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

export async function GET(request: Request) {
    if (!TELPHIN_APP_KEY || !TELPHIN_APP_SECRET) {
        return NextResponse.json({ error: 'Telphin config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const forceStart = searchParams.get('start');

        const token = await getTelphinToken();
        const storageKey = 'telphin_backfill_cursor';

        const BACKFILL_START_DATE = new Date('2025-09-01T00:00:00Z');
        const BACKFILL_END_DATE = new Date('2025-12-01T00:00:00Z');

        // 1. Determine Cursor & Ext Index
        let cursor = BACKFILL_START_DATE;
        let extIndex = 0;

        if (forceStart) {
            cursor = new Date(forceStart);
        } else {
            const { data: states } = await supabase
                .from('sync_state')
                .select('key, value')
                .in('key', [storageKey, 'telphin_backfill_ext_index']);

            const stateMap = new Map(states?.map(s => [s.key, s.value]));

            if (stateMap.has(storageKey)) cursor = new Date(stateMap.get(storageKey)!);
            if (stateMap.has('telphin_backfill_ext_index')) extIndex = parseInt(stateMap.get('telphin_backfill_ext_index') || '0');

            console.log(`[Backfill] Resuming: ${cursor.toISOString()} (Ext Index: ${extIndex})`);
        }

        if (cursor.getTime() >= BACKFILL_END_DATE.getTime()) {
            await updateState(storageKey, cursor.toISOString(), 0);
            return NextResponse.json({ status: 'completed', message: 'Backfill complete.' });
        }

        // 2. Process Slice
        const SLICE_MS = 24 * 60 * 60 * 1000;
        let endSliceMs = cursor.getTime() + SLICE_MS;
        if (endSliceMs > BACKFILL_END_DATE.getTime()) endSliceMs = BACKFILL_END_DATE.getTime();

        const fromD = cursor;
        const toD = new Date(endSliceMs);
        console.log(`[Backfill] Slice: ${fromD.toISOString()} -> ${toD.toISOString()}`);

        const fetchChunk = async (extId: number) => {
            // ... Code skipped, reused in loop logic ...
            // Re-inline or simplified helper:
            const params = new URLSearchParams({
                start_datetime: formatTelphinDate(fromD),
                end_datetime: formatTelphinDate(toD),
                order: 'asc',
                count: '500'
            });
            const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.status === 429) return 'LIMIT_HIT';
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        };

        let sliceCalls: any[] = [];
        let limitHit = false;
        let timeoutHit = false;
        let processedCount = 0;

        const startTime = Date.now();
        const TIMEOUT_SAFETY_MS = 8000;
        const BATCH_LIMIT = 3; // Optimistic 3

        let nextExtIndex = extIndex;

        for (let i = extIndex; i < EXTENSIONS.length; i++) {
            // Check budget
            if (Date.now() - startTime > TIMEOUT_SAFETY_MS || processedCount >= BATCH_LIMIT) {
                console.log('[Backfill] Yielding (Time/Batch limit).');
                timeoutHit = true;
                break;
            }

            const extId = EXTENSIONS[i];
            const result = await fetchChunk(extId);

            if (result === 'LIMIT_HIT') {
                limitHit = true;
                break;
            }

            // Success processing
            if (Array.isArray(result)) sliceCalls.push(...result);

            processedCount++;
            nextExtIndex = i + 1; // Explicitly advance marker

            await new Promise(r => setTimeout(r, 1500)); // 1.5s delay
        }

        let nextCursor = cursor;
        let finalExtIndex = nextExtIndex;
        let isSliceFinished = false;

        // Determine if we finished the slice
        if (finalExtIndex >= EXTENSIONS.length) {
            isSliceFinished = true;
            nextCursor = new Date(endSliceMs + 1000);
            finalExtIndex = 0; // Reset for next day
        }


        // SAVE RAW CALLS (What we got so far)
        let syncedCount = 0;
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

                if (rawFlow === 'out') {
                    fromNumber = r.ani_number || r.from_number;
                    toNumber = r.dest_number || r.to_number;
                }
                // Normalization
                let sFrom = String(fromNumber || '').replace(/[^\d]/g, '');
                if (sFrom.length === 11 && (sFrom.startsWith('7') || sFrom.startsWith('8'))) sFrom = sFrom.slice(1);

                let sTo = String(toNumber || '').replace(/[^\d]/g, '');
                if (sTo.length === 11 && (sTo.startsWith('7') || sTo.startsWith('8'))) sTo = sTo.slice(1);

                return {
                    telphin_call_id: record_uuid,
                    direction: direction,
                    from_number: fromNumber || 'unknown',
                    to_number: toNumber || 'unknown',
                    from_number_normalized: sFrom.length >= 10 ? sFrom : null,
                    to_number_normalized: sTo.length >= 10 ? sTo : null,
                    started_at: callDate.toISOString(),
                    duration_sec: r.duration || 0,
                    recording_url: r.record_url || r.storage_url || r.url || null,
                    raw_payload: r,
                    ingested_at: new Date().toISOString()
                };
            });

            const { error: rawError } = await supabase.from('raw_telphin_calls')
                .upsert(rawCalls, { onConflict: 'telphin_call_id' });

            if (rawError) console.error('[Backfill] Upsert Error:', rawError);
            else {
                syncedCount = rawCalls.length;
                console.log(`[Backfill] Upserted ${syncedCount} calls.`);
            }
        }

        // SAVE STATE
        await updateState(storageKey, nextCursor.toISOString(), finalExtIndex);

        return NextResponse.json({
            success: true,
            status: isSliceFinished ? 'slice_completed' : (limitHit ? 'rate_limited' : 'timeout_paused'),
            calls_found: syncedCount,
            current_cursor: nextCursor.toISOString(),
            next_ext_index: finalExtIndex,
            message: `Processed ${sliceCalls.length} calls. ` + (isSliceFinished ? 'Advancing slice.' : 'Paused/Resuming next run.')
        });

    } catch (error: any) {
        console.error('Telphin Backfill Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function updateState(cursorKey: string, cursorValue: string, extIndex: number) {
    const ts = new Date().toISOString();
    await supabase.from('sync_state').upsert([
        { key: cursorKey, value: cursorValue, updated_at: ts },
        { key: 'telphin_backfill_ext_index', value: String(extIndex), updated_at: ts }
    ], { onConflict: 'key' });
}
