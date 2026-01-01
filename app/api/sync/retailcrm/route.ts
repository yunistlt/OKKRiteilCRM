import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const maxDuration = 300;

// Helper to normalize phone numbers
function cleanPhone(val: any): string {
    if (!val) return '';
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
        const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
        const limit = 100;
        const filterDateFrom = '2023-01-01 00:00:00';

        const params = new URLSearchParams();
        params.append('apiKey', RETAILCRM_API_KEY);
        params.append('limit', String(limit));
        params.append('page', String(page));
        params.append('filter[createdAtFrom]', filterDateFrom);
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

            const p1 = cleanPhone(order.phone);
            if (p1) phones.add(p1);

            const p2 = cleanPhone(order.additionalPhone);
            if (p2) phones.add(p2);

            if (order.customer && order.customer.phones) {
                order.customer.phones.forEach((p: any) => {
                    const cp = cleanPhone(p.number);
                    if (cp) phones.add(cp);
                });
            }
            if (order.contact && order.contact.phones) {
                order.contact.phones.forEach((p: any) => {
                    const cp = cleanPhone(p.number);
                    if (cp) phones.add(cp);
                });
            }

            // Create "Event" (Snapshot of current order state)
            eventsToUpsert.push({
                id: order.id,
                order_id: order.id,
                created_at: order.createdAt,
                updated_at: new Date().toISOString(),
                number: order.number || String(order.id),
                status: order.status,
                event_type: 'snapshot',
                manager_id: order.managerId ? String(order.managerId) : null,
                phone: cleanPhone(order.phone) || null,
                customer_phones: Array.from(phones),
                totalsumm: order.totalSumm || 0,
                raw_payload: order
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
