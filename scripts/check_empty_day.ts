
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { getTelphinToken } from '../lib/telphin';

const EXTENSIONS = [
    94413, 94415, 145748, 349957, 349963, 351106 // Just first few
];

async function main() {
    console.log('--- PROBING TELPHIN FOR 2025-09-08 (UTC) ---');
    const token = await getTelphinToken();

    // Target specific day that seems stuck
    const fromD = new Date('2025-09-08T00:00:00Z');
    const toD = new Date('2025-09-09T00:00:00Z');

    const format = (d: Date) => d.toISOString().replace('T', ' ').split('.')[0];
    // Wait, Telphin expects 'YYYY-MM-DD HH:mm:ss' in... local time? Or UTC? 
    // The previous script used local components. Now we switched to getUTCFullYear.
    // Let's test BOTH formats if first fails? NO, just use the one we deployed: UTC.

    // Replicating `route.ts` new format logic:
    const formatTelphinDate = (date: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return (
            date.getUTCFullYear() + '-' +
            pad(date.getUTCMonth() + 1) + '-' +
            pad(date.getUTCDate()) + ' ' +
            pad(date.getUTCHours()) + ':' +
            pad(date.getUTCMinutes()) + ':' +
            pad(date.getUTCSeconds())
        );
    };

    console.log(`Querying interval: ${formatTelphinDate(fromD)} -> ${formatTelphinDate(toD)}`);

    let foundTotal = 0;

    for (const extId of EXTENSIONS) {
        const ps = new URLSearchParams({
            start_datetime: formatTelphinDate(fromD),
            end_datetime: formatTelphinDate(toD),
            order: 'asc',
            count: '10'
        });
        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${ps.toString()}`;

        try {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.status === 429) {
                console.log(`⚠️ Ext ${extId}: 429 Too Many Requests`);
                continue;
            }
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : 0;
            console.log(`Ext ${extId}: Found ${count} calls`);
            foundTotal += count;
        } catch (e: any) {
            console.error(`Ext ${extId}: Error ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\nTotal found in sample: ${foundTotal}`);
    if (foundTotal === 0) {
        console.log('CONCLUSION: This day is effectively empty (or we are looking at wrong timezone/extension).');
        console.log('The "stalled" cursor is likely just actively scanning empty space.');
    } else {
        console.log('CONCLUSION: Data EXISTS. Creating backfill entries should happen.');
    }
}

main();
