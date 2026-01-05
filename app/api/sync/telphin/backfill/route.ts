
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
        // LIMITATION: DO NOT FAST-FORWARD IF PARTIAL BATCH. API might be paging unexpectedly.
        const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
        let endDateMs = cursorDate.getTime() + WINDOW_MS;
        if (endDateMs > BACKFILL_END_DATE.getTime()) endDateMs = BACKFILL_END_DATE.getTime();
        const endDate = new Date(endDateMs);

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

        let nextCursor = cursorStr;
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

            const lastCall = calls[calls.length - 1];
            const lastTimeRaw = lastCall.start_time_gmt;
            const lastDate = new Date(lastTimeRaw + (lastTimeRaw.includes('Z') ? '' : 'Z'));

            if (lastDate.getTime() <= cursorDate.getTime()) {
                // High density protection (+1s)
                const forced = new Date(lastDate.getTime() + 1000);
                nextCursor = forced.toISOString();
            } else {
                nextCursor = lastDate.toISOString();
            }
        } else {
            // Empty batch? Meaning 0 calls in the 30-day window.
            // We MUST advance to the end of the window to avoid infinite loop.
            console.log(`[Backfill] Empty batch (0 calls). Advancing to ${endDate.toISOString()}`);
            nextCursor = endDate.toISOString();
        }

        // NO FAST-FORWARD HERE. Even if calls < 50, we just advance to the last record.
        // This ensures we don't accidentally skip data if API pages weirdly.

        await updateState(storageKey, nextCursor);

        return NextResponse.json({
            success: true,
            status: 'batch_completed',
            calls_found: syncedCount,
            current_cursor: nextCursor,
            message: `Batch (50) processed. Next cursor: ${nextCursor}`
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function updateState(cursorKey: string, cursorValue: string) {
    const ts = new Date().toISOString();
    await supabase.from('sync_state').upsert([
        { key: cursorKey, value: cursorValue, updated_at: ts }
    ], { onConflict: 'key' });
}
