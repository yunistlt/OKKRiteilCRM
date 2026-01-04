import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Hardcoded extensions list (same as main sync)
const EXTENSIONS = [
    94413, 94415, 145748, 349957, 349963, 351106, 469589,
    533987, 555997, 562946, 643886, 660848, 669428, 718843,
    765119, 768698, 775235, 775238, 805250, 809876, 813743,
    828290, 839939, 855176, 858926, 858929, 858932, 858935,
    911927, 946706, 968099, 969008, 982610, 995756, 1015712,
];

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
    return String(val).replace(/[^\d+]/g, '');
}

const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

export async function GET(request: Request) {
    if (!TELPHIN_APP_KEY || !TELPHIN_APP_SECRET) {
        return NextResponse.json({ error: 'Telphin config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const forceStart = searchParams.get('start'); // Optional override

        const token = await getTelphinToken();
        const storageKey = 'telphin_backfill_cursor';

        // BACKFILL BOUNDARIES
        const BACKFILL_START_DATE = new Date('2025-09-01T00:00:00Z');
        const BACKFILL_END_DATE = new Date('2025-12-01T00:00:00Z');

        // 1. Determine Cursor
        let cursor = BACKFILL_START_DATE;

        if (forceStart) {
            cursor = new Date(forceStart);
            console.log(`[Backfill] Forced start: ${cursor.toISOString()}`);
        } else {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', storageKey)
                .single();

            if (state?.value) {
                cursor = new Date(state.value);
                console.log(`[Backfill] Resuming from: ${cursor.toISOString()}`);
            } else {
                console.log(`[Backfill] Starting fresh from: ${cursor.toISOString()}`);
            }
        }

        // Check if finished
        if (cursor.getTime() >= BACKFILL_END_DATE.getTime()) {
            console.log('[Backfill] Reached target end date. Backfill complete.');
            return NextResponse.json({
                success: true,
                status: 'completed',
                cursor: cursor.toISOString(),
                message: 'Backfill period (Sept-Nov 2025) is fully synced.'
            });
        }

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
                    console.error(`[Backfill] Fetch failed for ext ${extId}: ${res.status}`);
                    return [];
                }
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (e) {
                console.error(`[Backfill] Fetch error for ext ${extId}:`, e);
                return [];
            }
        };

        // 2. Process one slice
        // Use 6 hours slice
        const SLICE_MS = 6 * 60 * 60 * 1000;
        let endSliceMs = cursor.getTime() + SLICE_MS;

        // Cap at end date
        if (endSliceMs > BACKFILL_END_DATE.getTime()) {
            endSliceMs = BACKFILL_END_DATE.getTime();
        }

        const fromD = cursor;
        const toD = new Date(endSliceMs);

        console.log(`[Backfill] Processing slice: ${formatTelphinDate(fromD)} -> ${formatTelphinDate(toD)}`);

        let sliceCalls: any[] = [];
        const BATCH_SIZE = 10;

        for (let i = 0; i < EXTENSIONS.length; i += BATCH_SIZE) {
            const chunkExts = EXTENSIONS.slice(i, i + BATCH_SIZE);
            const promises = chunkExts.map(extId => fetchChunk(extId, fromD, toD));
            const results = await Promise.all(promises);
            results.forEach(r => sliceCalls.push(...r));
        }

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

            if (rawError) console.error('[Backfill] Upsert Error:', rawError);
            else {
                syncedCount = rawCalls.length;
                console.log(`[Backfill] Upserted ${syncedCount} calls.`);
            }
        } else {
            console.log('[Backfill] No calls in this slice.');
        }

        // 3. Advance Cursor
        const nextCursor = new Date(endSliceMs + 1000); // +1s
        await supabase.from('sync_state').upsert({
            key: storageKey,
            value: nextCursor.toISOString(),
            updated_at: new Date().toISOString()
        });

        return NextResponse.json({
            success: true,
            slice_start: fromD.toISOString(),
            slice_end: toD.toISOString(),
            calls_found: syncedCount,
            next_cursor: nextCursor.toISOString(),
            completed_pct: ((nextCursor.getTime() - BACKFILL_START_DATE.getTime()) / (BACKFILL_END_DATE.getTime() - BACKFILL_START_DATE.getTime()) * 100).toFixed(1) + '%'
        });

    } catch (error: any) {
        console.error('Telphin Backfill Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
