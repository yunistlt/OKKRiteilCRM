
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';

async function testLimit() {
    console.log('--- DEBUG: Testing Telphin API Limit ---');
    const token = await getTelphinToken();

    // Pick an active extension (from previous logs or known list)
    const EXT_ID = 469589; // One from the logs that had calls

    // Request a SHORTER period (1 month) to satisfy API requirements
    const start = '2025-09-01 00:00:00';
    const end = '2025-10-01 00:00:00';

    const params = new URLSearchParams({
        start_datetime: start,
        end_datetime: end,
        order: 'asc',
        // 'limit': '1000' // Try to see if explicit limit helps, or if it ignores it
    });

    const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${EXT_ID}/record/?${params.toString()}`;
    console.log(`Fetching: ${url}`);

    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (Array.isArray(data)) {
        console.log(`Received ${data.length} records.`);
        if (data.length > 0) {
            console.log('First:', data[0].start_time_gmt);
            console.log('Last:', data[data.length - 1].start_time_gmt);
        }

        // Response Headers might have pagination info
        console.log('Headers:',
            res.headers.get('X-Pagination-Total-Count'),
            res.headers.get('X-Pagination-Page-Count'),
            res.headers.get('x-total-count') // Common variations
        );
    } else {
        console.log('Response not an array:', data);
    }
}

testLimit();
