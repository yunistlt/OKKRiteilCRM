
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';

const EXTENSIONS = [94413, 469589]; // Test with just 2 active extensions to save time/spam
// 469589 was the one that worked in debug script

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

async function diagnose() {
    console.log('--- DIAGNOSING SYNC LOGIC ---');

    // 1. Setup Dates
    const start = new Date('2025-09-01T00:00:00Z');
    const now = new Date(); // Today
    const token = await getTelphinToken();

    console.log(`Token: ${token ? 'OK' : 'MISSING'}`);

    const CHUNK_MS = 30 * 24 * 60 * 60 * 1000;

    async function fetchChunk(extId: number, fromD: Date, toD: Date) {
        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(fromD),
            end_datetime: formatTelphinDate(toD),
            order: 'asc',
        });
        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;
        console.log(`[Ext ${extId}] Fetching: ${params.toString()}`);

        try {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) {
                console.error(`[Ext ${extId}] FAILED: ${res.status}`);
                return [];
            }
            const data = await res.json();
            console.log(`[Ext ${extId}] Got ${Array.isArray(data) ? data.length : 'Not Array'} records`);
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error(`[Ext ${extId}] ERROR:`, e);
            return [];
        }
    }

    async function fetchExtensionRecords(extId: number) {
        let records: any[] = [];
        let cursor = start.getTime(); // Use local timestamp logic
        const nowTs = now.getTime();

        while (cursor < nowTs) {
            let endChunk = cursor + CHUNK_MS;
            if (endChunk > nowTs) endChunk = nowTs;

            const fromD = new Date(cursor);
            const toD = new Date(endChunk);

            const chunkData = await fetchChunk(extId, fromD, toD);
            records.push(...chunkData);

            cursor = endChunk; // Logic check: previous was endChunk + 1000. Let's try exact.
        }
        return records;
    }

    // Run for test extensions
    for (const ext of EXTENSIONS) {
        const recs = await fetchExtensionRecords(ext);
        console.log(`Total for ${ext}: ${recs.length}`);
    }
}

diagnose();
