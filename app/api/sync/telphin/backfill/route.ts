
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getTelphinToken } from '@/lib/telphin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) s = s.slice(1);
    return s.length >= 10 ? s : null;
}

const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

export async function GET(request: Request) {
    if (!TELPHIN_APP_KEY || !TELPHIN_APP_SECRET) {
        return NextResponse.json({ error: 'Telphin config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const forceStart = searchParams.get('start');

        const token = await getTelphinToken();
        const storageKey = 'telphin_backfill_cursor';

        // 1. Get Client ID
        const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const userData = await userRes.json();
        const clientId = userData.client_id;
        if (!clientId) throw new Error('Could not resolve Telphin Client ID');

        // BACKFILL BOUNDARIES
        const BACKFILL_END_DATE = new Date('2025-12-01T00:00:00Z');

        // 2. Determine Cursor
        // Default to Sept 1 if no cursor
        let cursorStr = '2025-09-01T00:00:00.000Z'; // fallback

        if (forceStart) {
            cursorStr = forceStart;
            console.log(`[Backfill] Forced start: ${cursorStr}`);
        } else {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', storageKey)
                .single();
            if (state?.value) cursorStr = state.value;
        }

        const cursorDate = new Date(cursorStr);
        if (cursorDate.getTime() >= BACKFILL_END_DATE.getTime()) {
            return NextResponse.json({ status: 'completed', message: 'Backfill complete.' });
        }

        // 3. Process Batch (Count = 50)
        // API Restriction: Range must be < 2 months. Use 30 days window.
        const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
        let endDateMs = cursorDate.getTime() + WINDOW_MS;
        if (endDateMs > BACKFILL_END_DATE.getTime()) endDateMs = BACKFILL_END_DATE.getTime();
        const endDate = new Date(endDateMs);

        console.log(`[Backfill] Batch Fetch (30d window): ${formatTelphinDate(cursorDate)} -> ${formatTelphinDate(endDate)}`);

        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(cursorDate),
            end_datetime: formatTelphinDate(endDate),
            order: 'asc',
            count: '50'
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params.toString()}`;

        // Timeout 9s
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 9000);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: controller.signal
        });
        clearTimeout(fetchTimeout);

        if (res.status === 429) {
            console.warn('[Backfill] Rate Limit (429). Pausing.');
            return NextResponse.json({ status: 'rate_limited' });
        }
        if (!res.ok) {
            throw new Error(`Telphin API Error: ${res.status}`);
        }

        const data = await res.json();
        const calls = Array.isArray(data) ? data : [];
        console.log(`[Backfill] Fetched ${calls.length} calls.`);

        let nextCursor = cursorStr; // Default: stay if empty
        let syncedCount = 0;

        if (calls.length > 0) {
            // Upsert Logic
            const rawCalls = calls.map((r: any) => {
                const record_uuid = r.record_uuid || r.RecordUUID || `rec_${Math.random()}`;
                const rawFlow = r.flow || r.direction;
                let direction = 'unknown';
                if (rawFlow === 'out') direction = 'outgoing';
                else if (rawFlow === 'in') direction = 'incoming';
                else if (rawFlow === 'incoming' || rawFlow === 'outgoing') direction = rawFlow;

                const startedRaw = r.start_time_gmt || r.init_time_gmt;
                // If API gives us specific format, parse it carefully, or rely on Date()
                // api returns "YYYY-MM-DD HH:mm:ss" usually in GMT if requested so
                const callDate = startedRaw ? new Date(startedRaw + (startedRaw.includes('Z') ? '' : 'Z')) : new Date();

                let fromNumber = r.from_number || r.ani_number;
                let toNumber = r.to_number || r.dest_number;

                if (rawFlow === 'out') {
                    fromNumber = r.ani_number || r.from_number;
                    toNumber = r.dest_number || r.to_number;
                }

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
            else syncedCount = rawCalls.length;

            // Update Cursor Logic
            // The new cursor is the `started_at` of the LAST record.
            // CAUTION: If the last record has the SAME timestamp as the current cursor, 
            // and the WHOLE batch was that timestamp, we are looping.
            const lastCall = calls[calls.length - 1];
            // Format from API: "2025-09-08 12:05:00"
            const lastTimeRaw = lastCall.start_time_gmt;
            const lastDate = new Date(lastTimeRaw + (lastTimeRaw.includes('Z') ? '' : 'Z'));

            // Check for loop/stuck
            // If new lastDate <= old cursorDate, we might be stuck?
            // Actually, because we use "start_datetime" (inclusive), we will always re-fetch the start point.
            // If we fetched 50 items and they ALL have timestamp T, next time we fetch start=T, we get SAME 50. Loop.
            // FIX: If lastDate.getTime() === cursorDate.getTime(), we MUST force advance by 1 second.

            if (lastDate.getTime() <= cursorDate.getTime()) {
                console.log('[Backfill] Batch timestamps stuck (high density). Forcing +1s advance.');
                const forced = new Date(lastDate.getTime() + 1000);
                nextCursor = forced.toISOString();
            } else {
                nextCursor = lastDate.toISOString();
            }
        } else {
            // Empy batch? Meaning we reached the END boundary (2025-12-01) or a gap?
            // If we provided 2025-12-01 as end, and got nothing, we are effectively done?
            // Or maybe just a gap? No, if there's a gap, API would jump to the next record ?
            // API documentation says "start_datetime ... returns records starting from ..."
            // So if there are no records between cursor and END, we are done.
            console.log('[Backfill] No calls found in range. Marking complete?');
            // Check if we are near end date
            if (cursorDate.getTime() < BACKFILL_END_DATE.getTime() - 24 * 3600 * 1000) {
                // If we are far from end date, maybe just advance by 1 day to be safe?
                // But normally global fetch skips gaps.
                // Let's assume we are done or just close enough.
                nextCursor = BACKFILL_END_DATE.toISOString();
            }
        }

        if (calls.length > 0 && calls.length < 50) {
            console.log(`[Backfill] Partial batch (${calls.length} < 50). Window exhausted. Advancing to ${endDate.toISOString()}`);
            nextCursor = endDate.toISOString();
        }

        await updateState(storageKey, nextCursor);

        return NextResponse.json({
            success: true,
            status: 'batch_completed',
            calls_found: syncedCount,
            current_cursor: nextCursor,
            message: `Batch (50) processed. Next cursor: ${nextCursor}`
        });

    } catch (error: any) {
        console.error('Telphin Backfill Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function updateState(cursorKey: string, cursorValue: string) {
    const ts = new Date().toISOString();
    await supabase.from('sync_state').upsert([
        { key: cursorKey, value: cursorValue, updated_at: ts }
    ], { onConflict: 'key' });
}
