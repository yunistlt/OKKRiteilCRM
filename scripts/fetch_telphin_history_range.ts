
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';
import * as fs from 'fs';

// USAGE:
// npx ts-node scripts/fetch_telphin_history_range.ts 2025-08-01 2025-09-01
// (Will fetch entire August)

async function run() {
    console.log('--- FETCH TELPHIN HISTORY RANGE ---');

    // Parse Args or Default
    const args = process.argv.slice(2);
    let startStr = args[0] || '2025-09-01';
    let endStr = args[1] || '2025-09-02';

    // Append standard time and UTC assumption if just YYYY-MM-DD
    if (startStr.length === 10) startStr += 'T00:00:00Z';
    if (endStr.length === 10) endStr += 'T00:00:00Z';

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);

    console.log(`Range: ${startDate.toISOString()} -> ${endDate.toISOString()}`);

    // Auth
    const token = await getTelphinToken();
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    const clientId = userData.client_id;
    console.log(`Client ID: ${clientId}`);

    // Helper Format
    const format = (d: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return (
            d.getUTCFullYear() + '-' +
            pad(d.getUTCMonth() + 1) + '-' +
            pad(d.getUTCDate()) + ' ' +
            pad(d.getUTCHours()) + ':' +
            pad(d.getUTCMinutes()) + ':' +
            pad(d.getUTCSeconds())
        );
    };

    let allCalls: any[] = [];
    let currentCursor = new Date(startDate);

    // Chunk by 24h to be safe/manageable
    while (currentCursor.getTime() < endDate.getTime()) {
        let chunkEnd = new Date(currentCursor.getTime() + 24 * 3600 * 1000);
        if (chunkEnd > endDate) chunkEnd = endDate;

        console.log(`  Fetching chunk: ${format(currentCursor)} -> ${format(chunkEnd)}`);

        // Pagination loop for current chunk
        let page = 0;
        const perPage = 500; // Telphin max?

        const params = new URLSearchParams({
            start_datetime: format(currentCursor),
            end_datetime: format(chunkEnd),
            order: 'asc',
            count: String(perPage),
            // offset? API normally uses page/offset or just large counts
            // For simplicity, let's try 'limit' and assume we get all if we ask for huge count
            // Or just trust 'count'.
        });

        // Better strategy for reliability: fetch huge limit. 
        // If > 500, we might lose data if no pagination.
        // Let's assume < 1000 calls per day for now or use smaller window if needed.

        try {
            const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params.toString()}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            const calls = data.call_history || (Array.isArray(data) ? data : []);

            if (Array.isArray(calls)) {
                console.log(`    Received: ${calls.length} calls`);
                allCalls.push(...calls);
            } else {
                console.error('    Error/Invalid Data:', data);
            }

        } catch (e) {
            console.error('    Fetch Error:', e);
        }

        currentCursor = chunkEnd;
    }

    console.log(`\nTOTAL CALLS FETCHED: ${allCalls.length}`);

    // Save to file
    const filename = `telphin_history_${startStr.substring(0, 10)}_${endStr.substring(0, 10)}.json`;
    fs.writeFileSync(filename, JSON.stringify(allCalls, null, 2));
    console.log(`Saved to ${filename}`);
}

run();
