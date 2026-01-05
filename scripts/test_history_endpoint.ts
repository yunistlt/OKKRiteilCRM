
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';

async function run() {
    console.log('--- TESTING CALL HISTORY ENDPOINT ---');

    const token = await getTelphinToken();
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

    // Sept 1 MSK Window: Aug 31 21:00 UTC -> Sept 1 21:00 UTC
    // Let's ask for the exact same window as before
    const START_STR = '2025-08-31T21:00:00.000Z';
    const END_STR = '2025-09-01T21:00:00.000Z';

    const params = new URLSearchParams({
        start_datetime: format(new Date(START_STR)),
        end_datetime: format(new Date(END_STR)),
        order: 'asc',
        count: '500'
    });

    // TRYING 'call_history' endpoint
    const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params.toString()}`;
    console.log('Fetching:', url);

    try {
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        console.log('Status:', res.status, res.statusText);

        if (!res.ok) {
            console.log(await res.text());
            return;
        }

        const calls = await res.json();

        if (Array.isArray(calls)) {
            console.log(`FETCHED HISTORY COUNT: ${calls.length}`);

            // Analyze a few
            if (calls.length > 0) {
                console.log('Sample Call:', JSON.stringify(calls[0], null, 2));

                // Count misses?
                const stats: any = {};
                calls.forEach((c: any) => {
                    const flow = c.flow || c.direction || 'unknown';
                    // check for 'result' or 'disposition'
                    const res = c.result || c.hangup_result || 'unknown';
                    stats[res] = (stats[res] || 0) + 1;
                });
                console.log('Breakdown:', stats);
            }
        } else {
            console.log('Response is not an array:', calls);
        }

    } catch (e) {
        console.error(e);
    }
}

run();
