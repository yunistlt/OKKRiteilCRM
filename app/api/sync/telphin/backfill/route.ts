
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

        // 1. Get Client ID (Required for Global Fetch)
        const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const userData = await userRes.json();
        const clientId = userData.client_id;
        if (!clientId) throw new Error('Could not resolve Telphin Client ID');

        // BACKFILL BOUNDARIES
        const BACKFILL_START_DATE = new Date('2025-09-01T00:00:00Z');
        const BACKFILL_END_DATE = new Date('2025-12-01T00:00:00Z');

        // 2. Determine Cursor
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

            if (state?.value) cursor = new Date(state.value);
            console.log(`[Backfill] Resuming from: ${cursor.toISOString()}`);
        }

        if (cursor.getTime() >= BACKFILL_END_DATE.getTime()) {
            await updateState(storageKey, cursor.toISOString());
            return NextResponse.json({ status: 'completed', message: 'Backfill complete.' });
        }

        // 3. Process Slice (Global Fetch)
        // REDUCED to 2 HOURS to ensure sub-10s execution on Vercel
        const SLICE_MS = 2 * 60 * 60 * 1000;
        let endSliceMs = cursor.getTime() + SLICE_MS;
        if (endSliceMs > BACKFILL_END_DATE.getTime()) endSliceMs = BACKFILL_END_DATE.getTime();

        const fromD = cursor;
        const toD = new Date(endSliceMs);

        console.log(`[Backfill] Global Fetch (2h): ${formatTelphinDate(fromD)} -> ${formatTelphinDate(toD)}`);

        // Mandatory "Gentle" delay before request (just in case)
        await new Promise(r => setTimeout(r, 1000));

        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(fromD),
            end_datetime: formatTelphinDate(toD),
            order: 'asc',
            count: '5000' // High limit just in case
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params.toString()}`;

        // Timeout the fetch itself to 9s to capture error before Vercel kills us
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 9000); // 9 seconds

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: controller.signal
        });
        clearTimeout(fetchTimeout);

        if (res.status === 429) {
            console.warn('[Backfill] Global Fetch Rate Limit (429). Pausing.');
            return NextResponse.json({ status: 'rate_limited' });
        }

        if (!res.ok) {
            throw new Error(`Telphin API Error: ${res.status}`);
        }

        const data = await res.json();
        const calls = Array.isArray(data) ? data : [];
        console.log(`[Backfill] Found ${calls.length} calls.`);

        // 4. Upsert Calls
        let syncedCount = 0;
        if (calls.length > 0) {
            const rawCalls = calls.map((r: any) => {
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
        }

        // 5. Update Cursor (Always advance if successful)
        await updateState(storageKey, toD.toISOString());

        return NextResponse.json({
            success: true,
            status: 'slice_completed',
            calls_found: syncedCount,
            current_cursor: toD.toISOString(),
            message: `Global fetch successful. Processed ${syncedCount} calls.`
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
