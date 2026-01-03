
import { supabase } from '../utils/supabase';
import fs from 'fs';
import path from 'path';

// Load .env.local manually
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
        });
        console.log('.env.local loaded.');
    }
} catch (e) {
    console.warn('Failed to load .env.local', e);
}

// Configuration
const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;
const FILTER_DATE_FROM = '2020-01-01 00:00:00';
const FILTER_DATE_TO = '2020-12-31 23:59:59';

// Helper to normalize phone numbers
function cleanPhone(val: any): string {
    if (!val) return '';
    return String(val).replace(/[^\d+]/g, '');
}

async function run() {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        console.error('RetailCRM config missing');
        process.exit(1);
    }

    console.log(`Starting BACKFILL from ${FILTER_DATE_FROM}...`);

    let page = 1;
    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
        // 1. Build URL
        const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
        const limit = 100;

        const params = new URLSearchParams();
        params.append('apiKey', RETAILCRM_API_KEY);
        params.append('limit', String(limit));
        params.append('page', String(page));
        params.append('filter[createdAtFrom]', FILTER_DATE_FROM);
        params.append('filter[createdAtTo]', FILTER_DATE_TO);
        params.append('paginator', 'page'); // Important for RetailCRM v5

        const url = `${baseUrl}/api/v5/orders?${params.toString()}`;
        console.log(`Fetching Page ${page}...`);

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`RetailCRM API Error: ${res.status}`);

            const data = await res.json();
            if (!data.success) throw new Error(`RetailCRM Success False: ${JSON.stringify(data)}`);

            const orders = data.orders || [];
            const pagination = data.pagination;

            if (orders.length === 0) {
                console.log('No more orders on this page.');
                hasMore = false;
                break;
            }

            // 2. Transform & Upsert
            const eventsToUpsert: any[] = [];
            for (const order of orders) {
                // Extract phones
                const phones = new Set<string>();
                const p1 = cleanPhone(order.phone); if (p1) phones.add(p1);
                const p2 = cleanPhone(order.additionalPhone); if (p2) phones.add(p2);
                if (order.customer && order.customer.phones) {
                    order.customer.phones.forEach((p: any) => { const cp = cleanPhone(p.number); if (cp) phones.add(cp); });
                }
                if (order.contact && order.contact.phones) {
                    order.contact.phones.forEach((p: any) => { const cp = cleanPhone(p.number); if (cp) phones.add(cp); });
                }

                eventsToUpsert.push({
                    id: order.id,
                    order_id: order.id,
                    created_at: order.createdAt,
                    updated_at: new Date().toISOString(),
                    number: order.number || String(order.id),
                    status: order.status,
                    event_type: 'backfill',
                    manager_id: order.managerId ? String(order.managerId) : null,
                    phone: cleanPhone(order.phone) || null,
                    customer_phones: Array.from(phones),
                    totalsumm: order.totalSumm || 0,
                    raw_payload: order
                });
            }

            if (eventsToUpsert.length > 0) {
                const { error } = await supabase.rpc('upsert_orders_v2', {
                    orders_data: eventsToUpsert
                });
                if (error) {
                    console.error('RPC Upsert Error:', error);
                    // Continue? Or stop? 
                    // Let's stop to avoid skipping data.
                    throw error;
                }
            }

            totalProcessed += orders.length;
            console.log(`Processed ${orders.length} orders. Total: ${totalProcessed}`);

            // 3. Advance Cursor
            if (pagination && pagination.currentPage < pagination.totalPageCount) {
                page++;
                // Small delay to be nice to API
                // await new Promise(r => setTimeout(r, 100)); 
            } else {
                hasMore = false;
                console.log('Reached last page.');
            }

        } catch (e) {
            console.error('Backfill Loop Error:', e);
            hasMore = false;
        }
    }

    console.log('Backfill Complete.');
}

run();
