import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

// Environment variables
const TELPHIN_KEY = process.env.TELPHIN_APP_KEY;
const TELPHIN_SECRET = process.env.TELPHIN_APP_SECRET;

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

async function getTelphinToken() {
    console.log(`Debug Auth: Key=${TELPHIN_KEY?.substring(0, 5)}... Secret=${TELPHIN_SECRET?.substring(0, 5)}...`);

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', TELPHIN_KEY!);
    params.append('client_secret', TELPHIN_SECRET!);
    params.append('scope', 'all'); // Added scope as per user snippet

    const res = await fetch('https://apiproxy.telphin.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Telphin Auth Failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return data.access_token;
}

const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

export const maxDuration = 300;

export async function GET(request: Request) {
    if (!TELPHIN_APP_KEY || !TELPHIN_APP_SECRET) {
        return NextResponse.json({ error: 'Telphin config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const forceResync = searchParams.get('force') === 'true';

        const token = await getTelphinToken();

        // Determine Start Date
        const { data: lastCall } = await supabase
            .from('calls')
            .select('timestamp')
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();

        const now = new Date();
        // User requested to start from Dec 1st, 2025 if DB is empty
        const defaultStart = new Date('2025-12-01T00:00:00Z');

        let start = defaultStart;
        if (!forceResync && lastCall?.timestamp) {
            console.log('Incremental sync from:', lastCall.timestamp);
            start = new Date(lastCall.timestamp);
        } else {
            console.log('Force/Full sync (30 days)');
        }

        const fromStr = formatTelphinDate(start);
        const toStr = formatTelphinDate(now);

        let allCalls: any[] = [];
        let debugLastUrl = '';

        // Fetch loop over extensions (using Parallel Batches)
        const fetchExtensionRecords = async (extId: number) => {
            const params = new URLSearchParams({
                start_datetime: fromStr,
                end_datetime: toStr,
                order: 'asc',
            });

            // Note: User snippet uses /extension/{id}/record/ instead of call_history
            // This is a DIFFERENT endpoint causing the difference!
            const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;
            if (!debugLastUrl) debugLastUrl = url;

            try {
                const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (e) {
                return [];
            }
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
                timestamp: callDate.toISOString()
            };
        });

        if (mappedCalls.length > 0) {
            const { error } = await supabase.from('calls').upsert(mappedCalls);
            if (error) console.error('Supabase Upsert Error:', error);
        }

        return NextResponse.json({
            success: true,
            count: mappedCalls.length,
            extensions_scanned: EXTENSIONS.length,
            debug_sample: mappedCalls[0],
            debug_last_url: debugLastUrl
        });

    } catch (error: any) {
        console.error('Telphin Sync Error:', error);
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
