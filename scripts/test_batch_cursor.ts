
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { getTelphinToken } from '../lib/telphin';

async function main() {
    console.log('--- TESTING BATCH CURSOR BEHAVIOR (FIXED) ---');
    const token = await getTelphinToken();

    // 1. Get Client ID
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    const clientId = userData.client_id;

    const startTime = '2025-09-08 12:00:00';
    console.log(`Start Time: ${startTime}`);

    // Fetch Batch 1 (Count 5) - WITH MANDATORY END_DATETIME
    console.log('\n--- Batch 1 (Count 5) ---');
    const params1 = new URLSearchParams({
        start_datetime: startTime,
        end_datetime: '2025-12-01 00:00:00', // Far future to allow "count" to be the limiter
        order: 'asc',
        count: '5'
    });
    const url1 = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params1.toString()}`;
    const res1 = await fetch(url1, { headers: { 'Authorization': `Bearer ${token}` } });

    if (res1.status !== 200) {
        console.log('Error', await res1.text());
        return;
    }

    const batch1 = await res1.json();
    console.log(`Batch 1 size: ${batch1.length}`);

    batch1.forEach((r: any, i: number) => {
        console.log(`[1-${i}] ${r.start_time_gmt} | ${r.record_uuid}`);
    });

    if (batch1.length === 0) return;

    // Simulate Cursor logic
    const lastRecord = batch1[batch1.length - 1];
    const newCursor = lastRecord.start_time_gmt;
    console.log(`\nNew Cursor from Last Record: ${newCursor}`);

    // Fetch Batch 2
    console.log('\n--- Batch 2 (Start = New Cursor) ---');
    const params2 = new URLSearchParams({
        start_datetime: newCursor,
        end_datetime: '2025-12-01 00:00:00',
        order: 'asc',
        count: '5'
    });
    const url2 = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params2.toString()}`;
    const res2 = await fetch(url2, { headers: { 'Authorization': `Bearer ${token}` } });
    const batch2 = await res2.json();

    batch2.forEach((r: any, i: number) => {
        console.log(`[2-${i}] ${r.start_time_gmt} | ${r.record_uuid}`);
    });

    // Check overlap
    const overlap = batch2[0].record_uuid === lastRecord.record_uuid;
    console.log(`\nOverlap detected (First of Batch 2 == Last of Batch 1)? ${overlap}`);

    if (overlap) {
        console.log('Strategy Adjust: Since overlap exists, we rely on UPSERT de-duplication.');
        const allSame = batch1.every((r: any) => r.start_time_gmt === batch1[0].start_time_gmt);
        console.log(`Are all timestamps in Batch 1 identical? ${allSame}`);
        if (allSame) {
            console.log('DANGER: Infinite Loop Risk if we do not advance cursor by 1s.');
        } else {
            console.log('Safe: We will re-fetch the last record but also new ones.');
        }
    }
}

main();
