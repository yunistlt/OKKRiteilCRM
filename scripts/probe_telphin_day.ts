
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { getTelphinToken } from '../lib/telphin';

const EXTENSIONS = [
    858926, // Trying a few random ones
    968099,
    145748
];

async function main() {
    console.log('--- PROBE TELPHIN 24H VOLUME ---');
    const token = await getTelphinToken();

    // Pick a busy day: Mon Sep 15 2025
    const fromD = new Date('2025-09-15T00:00:00Z');
    const toD = new Date('2025-09-16T00:00:00Z');

    const formatTelphinDate = (date: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        // Use UTC methods to ensure we send correct boundaries regardless of local time
        return (
            date.getUTCFullYear() +
            '-' +
            pad(date.getUTCMonth() + 1) +
            '-' +
            pad(date.getUTCDate()) +
            ' ' +
            pad(date.getUTCHours()) +
            ':' +
            pad(date.getUTCMinutes()) +
            ':' +
            pad(date.getUTCSeconds())
        );
    };

    async function fetchCount(extId: number) {
        const startStr = formatTelphinDate(fromD);
        const endStr = formatTelphinDate(toD);

        const params = new URLSearchParams({
            start_datetime: startStr,
            end_datetime: endStr,
            order: 'asc',
            count: '500' // Limit
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;
        console.log(`Checking Ext ${extId} (24h)...`);

        try {
            await new Promise(r => setTimeout(r, 1000)); // Be nice
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

            if (res.status === 429) {
                console.log('⚠️ 429 - Waiting 5s...');
                await new Promise(r => setTimeout(r, 5000));
                return; // fail
            }

            if (!res.ok) {
                console.log(`Error ${res.status}`);
                return;
            }

            const data = await res.json();
            if (Array.isArray(data)) {
                console.log(`✅ Ext ${extId}: ${data.length} calls in 24h.`);
                if (data.length >= 500) console.warn('❗ HIT 500 LIMIT! RISK OF DATA LOSS.');
            }
        } catch (e) {
            console.error('Fetch error:', e);
        }
    }

    for (const ext of EXTENSIONS) {
        await fetchCount(ext);
    }
}

main();
