
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

// Config
const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '';
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY || '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper
function cleanPhone(val: any) {
    if (!val) return '';
    return String(val).replace(/[^\d+]/g, '');
}

async function runSync() {
    console.log('--- RUNNING PRODUCTION SYNC (TIME-BASED) ---');

    // 1. Determine Start Date
    let filterDateFrom = '2023-01-01 00:00:00';

    const { data: lastOrder } = await supabase
        .from('orders')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (lastOrder && lastOrder.created_at) {
        const d = new Date(lastOrder.created_at);
        d.setDate(d.getDate() - 1);
        filterDateFrom = d.toISOString().slice(0, 19).replace('T', ' ');
        console.log(`[Sync] Last Order in DB: ${lastOrder.created_at}`);
        console.log(`[Sync] Fetching orders created after: ${filterDateFrom}`);
    } else {
        console.log('[Sync] No recent orders. Full sync from 2023.');
    }

    const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
    let page = 1;
    let hasMore = true;
    let totalSaved = 0;

    while (hasMore) {
        let url = `${baseUrl}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&limit=100&page=${page}&filter[createdAtFrom]=${encodeURIComponent(filterDateFrom)}&paginator=page`;

        console.log(`[Sync] Creating fetch request for Page ${page}...`);
        const res = await fetch(url);
        const data = await res.json();

        if (!data.success) {
            console.error('[Sync] API Error:', data);
            break;
        }

        const orders = data.orders || [];
        if (orders.length === 0) {
            console.log('[Sync] No more orders found.');
            break;
        }

        console.log(`[Sync] Page ${page}: Fetched ${orders.length} orders.`);

        // Transform
        const eventsToUpsert = [];
        for (const order of orders) {
            const phones = new Set();
            const p1 = cleanPhone(order.phone); if (p1) phones.add(p1);
            const p2 = cleanPhone(order.additionalPhone); if (p2) phones.add(p2);
            if (order.customer && order.customer.phones) order.customer.phones.forEach((p: any) => phones.add(cleanPhone(p.number)));
            if (order.contact && order.contact.phones) order.contact.phones.forEach((p: any) => phones.add(cleanPhone(p.number)));

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

        // Upsert
        const { error } = await supabase.rpc('upsert_orders_v2', {
            orders_data: eventsToUpsert
        });

        if (error) {
            console.error('[Sync] Upsert Error:', error);
        } else {
            console.log(`[Sync] Page ${page}: Saved ${eventsToUpsert.length} orders to DB.`);
            totalSaved += eventsToUpsert.length;
        }

        // Check Pagination
        const pagination = data.pagination;
        if (pagination && pagination.currentPage < pagination.totalPageCount) {
            page++;
        } else {
            hasMore = false;
        }
    }

    console.log(`[Sync] Completed. Total new/updated orders: ${totalSaved}`);
}

runSync();
