
import { supabase } from '../utils/supabase';
import fs from 'fs';
import path from 'path';

// Load Env
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, '');
                if (!process.env[key]) process.env[key] = value;
            }
        });
    }
} catch (e) { }

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function fetchFromRetailCRM(page: number, statuses: string[]) {
    const params = new URLSearchParams();
    params.append('apiKey', RETAILCRM_API_KEY || '');
    params.append('limit', '100');
    params.append('page', page.toString());
    statuses.forEach(s => params.append('filter[extendedStatus][]', s));

    const res = await fetch(`${RETAILCRM_URL}/api/v5/orders?${params.toString()}`);
    if (!res.ok) throw new Error(`RetailCRM error: ${res.status}`);
    return await res.json();
}

async function run() {
    console.log('Fetching working statuses...');
    const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
    const workingCodes = (workingSettings || []).map(s => s.code);

    if (workingCodes.length === 0) {
        console.log('No working codes found.');
        return;
    }

    console.log(`Working Codes: ${workingCodes.length}`);

    let page = 1;
    let totalProcessed = 0;

    while (true) {
        console.log(`Fetching page ${page}...`);
        const data = await fetchFromRetailCRM(page, workingCodes);
        const orders = data.orders || [];

        if (orders.length === 0) break;

        // Prepare updates
        // We use upsert on orders. orders PK is id.
        // We only want to update `updated_at`.
        // upsert requires minimal fields?
        // Actually, if we use `update()`, we need to do it one by one or in batch via rpc?
        // Supabase `upsert` allows bulk.
        // But if I upsert `{id: 1, updated_at: '...'}` and row has other non-null cols, if it tries to INSERT, it fails.
        // But since I know they exist (I just fetched "working" orders which I backfilled), it should hit ON CONFLICT DO UPDATE.
        // Wait, on conflict update implies replacing fields.
        // Supabase `upsert` works if row exists.

        const updates = orders.map((o: any) => ({
            id: o.id,
            updated_at: o.updatedAt, // RetailCRM format "YYYY-MM-DD HH:mm:ss" usually works
            // We must provide other non-nulls if it TRIES to insert?
            // "number" is usually required.
            // Let's pass number too just in case.
            number: o.number,
            // status is required
            status: o.status
        }));

        const { error } = await supabase.from('orders').upsert(updates, { onConflict: 'id' });

        if (error) {
            console.error('Upsert Error:', error);
        } else {
            console.log(`Restored timestamps for ${updates.length} orders.`);
        }

        totalProcessed += orders.length;
        if (orders.length < 100) break;
        page++;
    }

    console.log(`Done. Processed ${totalProcessed} orders.`);
}

run();
