
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';
import { supabase } from '../utils/supabase';

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
        date.getFullYear() + '-' +
        pad(date.getMonth() + 1) + '-' +
        pad(date.getDate()) + ' ' +
        pad(date.getHours()) + ':' +
        pad(date.getMinutes()) + ':' +
        pad(date.getSeconds())
    );
}

function normalizePhone(val: any) {
    if (!val) return null;
    return String(val).replace(/[^\d+]/g, '');
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function runBackfill() {
    console.log('🚀 STARTING LOCAL BACKFILL (Fixed Delays)');
    const token = await getTelphinToken();
    const start = new Date('2025-09-01T00:00:00Z');
    const now = new Date();
    const CHUNK_MS = 30 * 24 * 60 * 60 * 1000;

    let totalSaved = 0;

    for (const extId of EXTENSIONS) {
        let cursor = start.getTime();
        const nowTs = now.getTime();
        console.log(`\n--- Extension ${extId} ---`);

        while (cursor < nowTs) {
            let endChunk = cursor + CHUNK_MS;
            if (endChunk > nowTs) endChunk = nowTs;

            const fromD = new Date(cursor);
            const toD = new Date(endChunk);

            // Fetch
            const params = new URLSearchParams({
                start_datetime: formatTelphinDate(fromD),
                end_datetime: formatTelphinDate(toD),
                order: 'asc',
            });
            const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;

            try {
                // Retry loop
                let data = [];
                let retries = 5;
                while (retries > 0) {
                    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
                    if (res.status === 429) {
                        console.log('⚠️ 429 Limit. Sleeping 30s...');
                        await delay(30000);
                        retries--;
                        continue;
                    }
                    if (!res.ok) {
                        console.error(`Status ${res.status}`);
                        break;
                    }
                    data = await res.json();
                    break;
                }

                if (Array.isArray(data) && data.length > 0) {
                    process.stdout.write(`Found ${data.length}... `);

                    // SAVE TO DB
                    const rows = data.map((c: any) => ({
                        telphin_call_id: c.id,
                        call_type: c.flow,
                        status: c.result,
                        from_number: normalizePhone(c.source),
                        to_number: normalizePhone(c.target),
                        extension: String(c.from_pin),
                        duration_sec: c.duration,
                        started_at: c.start_time_gmt,
                        recording_url: c.record_url,
                        raw_payload: c
                    }));

                    const { error } = await supabase.from('raw_telphin_calls').upsert(rows, { onConflict: 'telphin_call_id' });
                    if (error) console.error('DB Error:', error.message);
                    else {
                        totalSaved += rows.length;
                        process.stdout.write('Saved ✅\n');
                    }
                } else {
                    process.stdout.write('.');
                }

            } catch (e) {
                console.error('Error:', e);
            }

            cursor = endChunk + 1000;
            await delay(3000); // Politeness 3s
        }
    }
    console.log(`\n🎉 DONE! Total calls saved: ${totalSaved}`);
}

runBackfill();
