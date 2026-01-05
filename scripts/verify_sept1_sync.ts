
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';

async function run() {
    console.log('--- VERIFYING SEPT 1st COUNTS (Expanded Analysis) ---');

    const token = await getTelphinToken();

    // 1. Get Client ID
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    const clientId = userData.client_id;
    console.log('Client ID:', clientId);

    const pad = (n: number) => String(n).padStart(2, '0');
    const format = (d: Date) => {
        return (
            d.getUTCFullYear() + '-' +
            pad(d.getUTCMonth() + 1) + '-' +
            pad(d.getUTCDate()) + ' ' +
            pad(d.getUTCHours()) + ':' +
            pad(d.getUTCMinutes()) + ':' +
            pad(d.getUTCSeconds())
        );
    };

    // Expanded window: 31 Aug 18:00 UTC -> 2 Sept 00:00 UTC
    // This covers MSK day (31 Aug 21:00 -> 1 Sept 21:00) with generous types
    const FETCH_START = new Date('2025-08-31T18:00:00.000Z');
    const FETCH_END = new Date('2025-09-02T00:00:00.000Z');

    console.log(`Fetching wide range: ${format(FETCH_START)} -> ${format(FETCH_END)}`);

    let allCalls: any[] = [];
    let page = 0;

    // Naive fetch loop
    let currentStart = new Date(FETCH_START);

    while (currentStart < FETCH_END) {
        let currentEnd = new Date(currentStart.getTime() + 12 * 3600 * 1000); // 12h chunks
        if (currentEnd > FETCH_END) currentEnd = FETCH_END;

        const params = new URLSearchParams({
            start_datetime: format(currentStart),
            end_datetime: format(currentEnd),
            order: 'asc',
            limit: '10000' // Try big limit
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params.toString()}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const batch = await res.json();
        if (Array.isArray(batch)) {
            allCalls.push(...batch);
            console.log(`  Fetched chunk ${format(currentStart)}: ${batch.length} calls`);
        }

        currentStart = currentEnd;
    }

    console.log(`\nTotal Raw Fetched: ${allCalls.length}`);

    // ANALYSIS

    // MSK Window: Aug 31 21:00:00 UTC -> Sept 1 20:59:59 UTC
    const MSK_START_MS = new Date('2025-08-31T21:00:00.000Z').getTime();
    const MSK_END_MS = new Date('2025-09-01T21:00:00.000Z').getTime(); // Exclusive

    let mskCount = 0;
    const stats: any = {};
    const dispositions: any = {};

    for (const call of allCalls) {
        const rawT = call.start_time_gmt || call.init_time_gmt;
        const t = new Date(rawT + (rawT.includes('Z') ? '' : 'Z')).getTime();

        if (t >= MSK_START_MS && t < MSK_END_MS) {
            mskCount++;

            const flow = call.flow || call.direction || 'unknown';
            stats[flow] = (stats[flow] || 0) + 1;

            const result = call.result || 'unknown';
            dispositions[result] = (dispositions[result] || 0) + 1;
        }
    }

    console.log('------------------------------------------------');
    console.log(`MATCHING SEP 1 (MSK): ${mskCount} calls`);
    console.log('Breakdown by FLOW:', stats);
    console.log('Breakdown by DISPOSITION:', dispositions);
    console.log('------------------------------------------------');
    console.log(`EXPECTED: 184`);
    console.log('------------------------------------------------');
}

run();
