
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';
import { getTelphinToken } from '../lib/telphin';
import { normalizePhone } from '../lib/phone-utils';
import * as fs from 'fs';
import * as path from 'path';

// Progress file to resume fetching
const PROGRESS_FILE = path.join(process.cwd(), 'fetch_progress.json');

function formatTelphinDate(date: Date) {
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
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchHistory() {
    console.log('=== FETCHING TELPHIN GLOBAL HISTORY (SLOW & GENTLE) ===');

    // Default Start
    let start = new Date('2025-09-01T00:00:00Z');
    const now = new Date();

    // Resume functionality
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
            if (saved.last_processed_time) {
                console.log(`Resuming from saved progress: ${saved.last_processed_time}`);
                start = new Date(saved.last_processed_time);
            }
        } catch (e) {
            console.warn('Failed to read progress file, starting from scratch.');
        }
    }

    console.log('Authenticating...');
    const token = await getTelphinToken();

    // 1. Get Client ID
    console.log('Resolving Client ID...');
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    let clientId = 10459; // Fallback
    if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.client_id) {
            clientId = userData.client_id;
        }
    }
    console.log(`Using Client ID: ${clientId}`);

    // 2. Fetch Loop
    // Strategy: 1 hour chunks, 2 second sleep. If 429 -> 60 second sleep.

    let currentStart = new Date(start);
    let totalCalls = 0;

    console.log(`Starting fetch from ${formatTelphinDate(currentStart)} ...`);

    while (currentStart < now) {
        let currentEnd = new Date(currentStart);
        currentEnd.setMinutes(currentEnd.getMinutes() + 60); // 60 minutes chunk
        if (currentEnd > now) currentEnd = now;

        const chunkFrom = formatTelphinDate(currentStart);
        const chunkTo = formatTelphinDate(currentEnd);

        // STANDARD DELAY: 2 seconds
        await sleep(2000);

        const params = new URLSearchParams({
            start_datetime: chunkFrom,
            end_datetime: chunkTo,
            order: 'asc',
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params.toString()}`;

        try {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

            if (res.status === 429) {
                console.warn(`\n⚠️ Rate Limit Hit at ${chunkFrom}. Sleeping 60s...`);
                await sleep(60000);
                // Reduce chunk size logic could go here, but for now just retry
                continue;
            }

            if (!res.ok) {
                console.error(`\n❌ Error fetching ${chunkFrom}: ${res.status} ${res.statusText}`);
                // Skip bad chunk to avoid lock, but log it
                currentStart = currentEnd;
                saveProgress(currentStart);
                continue;
            }

            const data = await res.json();
            const records = Array.isArray(data) ? data : [];

            if (records.length >= 50) {
                console.warn(`\n  ⚠️ Warning: Chunk ${chunkFrom} returned ${records.length} records. Close to limit?`);
            }

            if (records.length > 0) {
                await processAndInsert(records);
                totalCalls += records.length;
            }

            process.stdout.write(`\r[${chunkFrom}] +${records.length} calls | Total: ${totalCalls}`);

            // Advance and Save
            currentStart = currentEnd;
            saveProgress(currentStart);

        } catch (e) {
            console.error(`\nNetwork error at ${chunkFrom}`, e);
            await sleep(10000);
        }
    }

    console.log(`\n\n✅ Done! Total sourced calls: ${totalCalls}`);
    // Cleanup progress file on success
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
}

function saveProgress(date: Date) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ last_processed_time: date.toISOString() }));
}

async function processAndInsert(rawRecords: any[]) {
    const mappedCalls = rawRecords.map((r: any) => {
        const flow = r.flow || r.direction;
        let fromNumber = '';
        let toNumber = '';

        if (flow === 'out') {
            fromNumber = r.ani_number || r.from_number;
            toNumber = r.dest_number || r.to_number;
        } else if (flow === 'in') {
            fromNumber = r.ani_number || r.from_number;
            toNumber = r.dest_number || r.to_number;
        } else {
            fromNumber = r.from_number || r.ani_number;
            toNumber = r.to_number || r.dest_number;
        }

        const direction = flow === 'in' ? 'incoming' : 'outgoing';
        const callId = r.record_uuid || r.RecordUUID || `rec_${Math.random()}`;
        const extId = r.extension_id;

        return {
            telphin_call_id: callId,
            direction,
            from_number: fromNumber,
            to_number: toNumber,
            from_number_normalized: normalizePhone(fromNumber),
            to_number_normalized: normalizePhone(toNumber),
            started_at: r.start_time_gmt ? new Date(r.start_time_gmt + 'Z').toISOString() : new Date().toISOString(),
            duration_sec: r.duration || 0,
            recording_url: r.record_url || r.storage_url || r.url || null,
            raw_payload: {
                ...r,
                extension_id: extId,
                source: 'global_fetch_slow'
            }
        };
    });

    const { error } = await supabase.from('raw_telphin_calls').upsert(mappedCalls, { onConflict: 'telphin_call_id', ignoreDuplicates: true });
    if (error) {
        console.error('\nInsert Error:', error.message);
    }
}

fetchHistory().catch(console.error);
