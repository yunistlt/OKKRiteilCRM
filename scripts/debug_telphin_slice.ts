
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { getTelphinToken } from '../lib/telphin';

const EXTENSIONS = [
    94413, 94415, 145748, 349957, 349963, 351106, 469589,
    533987, 555997, 562946, 643886, 660848, 669428, 718843,
    765119, 768698, 775235, 775238, 805250, 809876, 813743,
    828290, 839939, 855176, 858926, 858929, 858932, 858935,
    911927, 946706, 968099, 969008, 982610, 995756, 1015712,
];

async function main() {
    console.log('--- DEBUG TELPHIN SLICE ---');
    const token = await getTelphinToken();
    console.log('Token acquired.');

    // Time from Sync State: 2025-09-08T17:00:40.000Z
    const fromD = new Date('2025-09-08T17:00:40.000Z');
    const toD = new Date(fromD.getTime() + 60 * 60 * 1000); // +1 hour

    console.log(`Checking slice: ${fromD.toISOString()} -> ${toD.toISOString()}`);

    async function fetchExt(extId: number) {
        const formatDate = (d: Date) => {
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
        };
        // The API actually expects "YYYY-MM-DD HH:mm:ss" in... what timezone? 
        // Sync code uses `formatTelphinDate` which uses `date.getFullYear()`.
        // If the server is UTC, `getFullYear` returns local time if not careful.
        // Wait, `formatTelphinDate` in `route.ts`:
        /*
        function formatTelphinDate(date: Date) {
            const pad = (n: number) => String(n).padStart(2, '0');
            return (
                date.getFullYear() + ...
            );
        }
        */
        // If Vercel runs in UTC, then `date.getFullYear()` is UTC.
        // If Mac runs in MSK, it's MSK.
        // `route.ts` creates dates via `new Date('...Z')`.
        // So `date` object is correct instant.
        // But `date.getFullYear()` uses LOCAL system time.
        // If Vercel is UTC, it sends UTC string.
        // Telphin expects... Mosow time? Or UTC? 
        // Older code investigations suggested Telphin expects GMT if `start_time_gmt` is not used, or maybe just "YYYY-MM-DD HH:mm:ss" interpreted as... ?

        // Let's use exactly what route uses.

        const formatTelphinDate = (date: Date) => {
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
        };

        // IMPORTANT: On this local machine, formatTelphinDate will use LOCAL time.
        // The Vercel function uses UTC (likely).
        // Let's print what we are sending.
        const startStr = formatTelphinDate(fromD);
        const endStr = formatTelphinDate(toD);

        const params = new URLSearchParams({
            start_datetime: startStr,
            end_datetime: endStr,
            order: 'asc',
            count: '50'
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;
        console.log(`Testing Ext ${extId}... URL: ${url}`);

        try {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) {
                console.log(`Error ${res.status}`);
                return;
            }
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                console.log(`✅ FOUND ${data.length} calls for ${extId}`);
                console.log('Sample:', JSON.stringify(data[0], null, 2));
            } else {
                process.stdout.write('.');
            }
        } catch (e) {
            console.error('Fetch error:', e);
        }
    }

    // Check first 5 extensions
    for (const ext of EXTENSIONS.slice(0, 5)) {
        await fetchExt(ext);
    }
    console.log('\nDone.');
}

main();
