
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchRetailHistory() {
    console.log('=== FETCHING RETAILCRM FULL HISTORY ===');

    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        console.error('RetailCRM Config Missing');
        process.exit(1);
    }

    // Pagination (History uses 'sinceId' usually, not pages)
    // Actually /api/v5/orders/history uses `limit` and `page` OR `sinceId`?
    // Docs: `sinceId` is preferred for synchronization.

    // We should start from 0 or get last known ID from DB if implemented.
    // For now, let's start fresh or a specific date?
    // History endpoint allows filtering by `startDate`.

    let page = 1;
    let hasMore = true;
    let totalEvents = 0;

    const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');

    // Start fetching from 2025-01-01 maybe? Or earlier? 
    // User mentioned calling 2020 data? Let's check from 2024-01-01 to be safe and recent.
    // Or user wants global backfill?
    // Let's try to fetch last 2 years.

    const startDate = '2024-01-01 00:00:00';

    console.log(`Fetching history starting from ${startDate}...`);

    while (hasMore) {
        const params = new URLSearchParams();
        params.append('apiKey', RETAILCRM_API_KEY);
        params.append('filter[startDate]', startDate);
        params.append('limit', '100');
        params.append('page', String(page));

        const url = `${baseUrl}/api/v5/orders/history?${params.toString()}`;

        // Rate limit handling (RetailCRM is usually 10 req/sec, we are safe with serial)
        await sleep(200);

        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`Error ${res.status}: ${res.statusText}`);
                const txt = await res.text();
                // console.error(txt);
                break;
            }

            const data = await res.json();
            if (!data.success) {
                console.error('API Success False:', JSON.stringify(data));
                break;
            }

            const history = data.history || [];
            if (history.length === 0) {
                hasMore = false;
                break;
            }

            // Process History Entries
            const eventsToInsert: any[] = [];

            for (const item of history) {
                // Determine event type
                // item.type can be 'api', 'parameter', 'status', 'manager', 'delivery'...

                let eventType = 'unknown';
                if (item.field === 'status') eventType = 'status_changed';
                else if (item.field === 'manager') eventType = 'manager_changed';
                else if (item.field === 'order_product') eventType = 'product_changed';
                else if (item.field === 'payment') eventType = 'payment_changed';
                else eventType = item.field || 'generic_update';

                // Inspect for "Telephony" or "Call"
                // Sometimes call events appear as integration events.

                // Map to raw_order_events
                // We assume `order` object exists in history item?
                // History item structure: { id, createdAt, field, oldValue, newValue, order: { id, ... } }

                if (!item.order) continue; // Skip if no order link

                eventsToInsert.push({
                    retailcrm_order_id: item.order.id,
                    event_type: eventType,
                    occurred_at: item.createdAt, // This is the EXACT usage time
                    source: 'retailcrm_history',
                    raw_payload: item // Save full history item
                });
            }

            if (eventsToInsert.length > 0) {
                const { error } = await supabase.from('raw_order_events').insert(eventsToInsert);
                if (error) {
                    // Ignore duplicates if re-running
                    if (!error.message.includes('unique')) console.error('Insert error:', error.message);
                } else {
                    totalEvents += eventsToInsert.length;
                    process.stdout.write(`\rPage ${page}: +${eventsToInsert.length} events | Total: ${totalEvents}`);
                }
            }

            const pagination = data.pagination;
            if (pagination && pagination.currentPage < pagination.totalPageCount) {
                page++;
            } else {
                hasMore = false;
            }

        } catch (e) {
            console.error('Network Error:', e);
            await sleep(5000);
        }
    }

    console.log(`\n✅ Done. Total events fetched: ${totalEvents}`);
}

fetchRetailHistory().catch(console.error);
