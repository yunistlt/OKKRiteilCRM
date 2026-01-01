import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const maxDuration = 300;

// Helper to normalize phone numbers
function cleanPhone(val: any) {
    if (!val) return null;
    return String(val).replace(/[^\d+]/g, '');
}

export async function GET(request: Request) {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const forceResync = searchParams.get('force') === 'true';
        const storageKey = 'retailcrm_last_sync_page';

        // 1. Determine "Page" to fetch (Pagination Cursor)
        let page = 1;

        if (!forceResync) {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', storageKey)
                .single();

            if (state?.value) {
                page = parseInt(state.value) || 1;
            }
        } else {
            console.log('Force resync requested: Starting from Page 1');
        }

        // 2. Build URL for "Orders List" (Reverse Sync)
        // STRATEGY: Fetch all orders from 2023-01-01 onwards using the standard list endpoint.
        // This avoids iterating through years of empty history.
        const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
        const limit = 100;
        const filterDateFrom = '2023-01-01 00:00:00';

        const params = new URLSearchParams();
        params.append('apiKey', RETAILCRM_API_KEY);
        params.append('limit', String(limit));
        params.append('page', String(page));
        params.append('filter[createdAtFrom]', filterDateFrom);
        // We want newest orders? Or oldest first? 
        // If we want to catch up history, 'createdAt' ASC (default?) is safer.
        // But if we want *immediate* results on the dashboard, maybe DESC?
        // Let's stick to default (usually ID/Created ASC) to allow proper pagination forward.

        // Ensure we get phone numbers
        params.append('paginator', 'page');

        const url = `${baseUrl}/api/v5/orders?${params.toString()}`;
        console.log(`Fetching RetailCRM Page ${page}:`, url);

        // 3. Fetch Data
        const res = await fetch(url);
        if (!res.ok) throw new Error(`RetailCRM API Error: ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(`RetailCRM Success False: ${JSON.stringify(data)}`);

        const orders = data.orders || [];
        const pagination = data.pagination;

        const eventsToUpsert: any[] = [];

        // 4. Transform to Database Format
        for (const order of orders) {
            // Extract phones
            const phones = new Set<string>();
            if (order.phone) phones.add(cleanPhone(order.phone));
            if (order.additionalPhone) phones.add(cleanPhone(order.additionalPhone));

            if (order.customer && order.customer.phones) {
                order.customer.phones.forEach((p: any) => phones.add(cleanPhone(p.number)));
            }
            if (order.contact && order.contact.phones) {
                order.contact.phones.forEach((p: any) => phones.add(cleanPhone(p.number)));
            }

            // Create "Event" (Snapshot of current order state)
            eventsToUpsert.push({
                // For the main orders table, we want unique Order ID.
                // If the table 'orders' has PK = 'id' (Event ID), this might conflict if we assume 1:1 map.
                // BUT in our new schema, 'id' is bigInt PK.
                // Let's use the CRM Order ID as the Event ID for this initial sync to ensure uniqueness per order.
                // OR let Supabase generate UUID?
                // The schema has 'id bigint'. Let's use order.id.
                id: order.id,
                order_id: order.id,

                created_at: order.createdAt,
                updated_at: new Date().toISOString(),

                number: order.number || String(order.id),
                status: order.status,
                event_type: 'snapshot', // Mark as full snapshot

                manager_id: order.managerId ? String(order.managerId) : null,
                phone: cleanPhone(order.phone),
                customer_phones: Array.from(phones),
                totalsumm: order.totalSumm || 0,

                raw_payload: order // Store full payload
            });
        }

        // 5. Upsert
        if (eventsToUpsert.length > 0) {
            const { error } = await supabase.from('orders').upsert(eventsToUpsert);
            if (error) {
                console.error('Supabase Upsert Error:', error);
                throw error;
            }
        }

        // 6. Advance Cursor
        let hasMore = false;
        if (pagination && pagination.currentPage < pagination.totalPageCount) {
            hasMore = true;
            const nextPage = page + 1;

            await supabase.from('sync_state').upsert({
                key: storageKey,
                value: String(nextPage),
                updated_at: new Date().toISOString()
            });
        } else {
            // Finished all pages? Or loop just for this cron run?
            // If we finished, maybe reset to 1 (to re-scan for updates later)? 
            // With this logic, we scan once. 
            // Ideally for updates we switch back to 'history'.
            // But for now, let's just paginate until done.
        }

        return NextResponse.json({
            success: true,
            method: 'orders_list_filtered_2023',
            page: page,
            total_pages: pagination ? pagination.totalPageCount : '?',
            orders_fetched: orders.length,
            has_more: hasMore
        });

    } catch (error: any) {
        console.error('RetailCRM Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
