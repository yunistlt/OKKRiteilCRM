
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';
import { getTelphinToken } from '@/lib/telphin';

// Hardcoded extensions list (same as route.ts)
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

async function debugSyncDay() {
    const TARGET_DATE = '2025-11-11';
    console.log(`🔍 Debugging Telphin Sync for ${TARGET_DATE}...`);

    // 1. Check existing
    const startOfDay = `${TARGET_DATE}T00:00:00`;
    const endOfDay = `${TARGET_DATE}T23:59:59`;

    const { count: startCount } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .gte('started_at', startOfDay)
        .lte('started_at', endOfDay);

    console.log(`📊 Current DB Count for ${TARGET_DATE}: ${startCount}`);

    const token = await getTelphinToken();
    console.log('🔑 Token acquired.');

    const fromD = new Date(startOfDay);
    const toD = new Date(endOfDay);

    let allCalls: any[] = [];

    // Helper to fetch one chunk
    const fetchChunk = async (extId: number) => {
        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(fromD),
            end_datetime: formatTelphinDate(toD),
            order: 'asc',
        });
        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;

        try {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) {
                console.error(`❌ Fetch failed for ext ${extId}: ${res.status} ${res.statusText}`);
                if (res.status === 404) return [];
                const txt = await res.text();
                console.error(`   Body: ${txt.substring(0, 100)}`);
                return [];
            }
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error(`Fetch error for ext ${extId}:`, e);
            return [];
        }
    };

    // Parallel execution
    console.log(`📡 Fetching from ${EXTENSIONS.length} extensions...`);

    const promises = EXTENSIONS.map(id => fetchChunk(id));
    const results = await Promise.all(promises);
    results.forEach(records => allCalls.push(...records));

    console.log(`✅ Fetched ${allCalls.length} records total.`);

    if (allCalls.length > 0) {
        console.log('Sample Raw Record:', allCalls[0]);

        // Map and Insert
        const rawCalls = allCalls.map((r: any) => {
            const record_uuid = r.record_uuid || r.RecordUUID || `rec_${Math.random()}`;
            const flow = r.flow || r.direction;
            const startedRaw = r.start_time_gmt || r.init_time_gmt;

            let fromNumber = null;
            let toNumber = null;

            if (flow === 'out') {
                fromNumber = r.ani_number || r.from_number;
                toNumber = r.dest_number || r.to_number;
            } else {
                fromNumber = r.from_number || r.ani_number;
                toNumber = r.to_number || r.dest_number;
            }

            // Correct Direction Mapping
            let direction = 'unknown';
            if (flow === 'out') direction = 'outgoing';
            else if (flow === 'in') direction = 'incoming';
            else if (flow === 'incoming' || flow === 'outgoing') direction = flow;

            return {
                telphin_call_id: record_uuid,
                direction: direction,
                from_number: fromNumber || 'unknown',
                to_number: toNumber || 'unknown',
                from_number_normalized: normalizePhone(fromNumber),
                to_number_normalized: normalizePhone(toNumber),
                started_at: startedRaw ? new Date(startedRaw + 'Z').toISOString() : new Date().toISOString(),
                duration_sec: r.duration || 0,
                recording_url: r.record_url || r.storage_url || r.url || null,
                raw_payload: r,
                ingested_at: new Date().toISOString()
            };
        });

        console.log(`💾 Inserting ${rawCalls.length} records into DB...`);
        const { error: rawError } = await supabase.from('raw_telphin_calls')
            .upsert(rawCalls, { onConflict: 'telphin_call_id' });

        if (rawError) {
            console.error('❌ Supabase Upsert Error:', rawError);
        } else {
            console.log('✅ Upsert successful.');
        }

        // Verify final count
        const { count: endCount } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .gte('started_at', startOfDay)
            .lte('started_at', endOfDay);

        console.log(`📊 Final DB Count for ${TARGET_DATE}: ${endCount}`);
    } else {
        console.log('⚠️ No calls found for this date across all extensions.');
    }
}

debugSyncDay();
