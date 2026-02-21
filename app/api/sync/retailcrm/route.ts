import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const dynamic = 'force-dynamic';

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
        const startTime = Date.now();
        const maxTimeMs = 50000; // 50 seconds limit (Vercel hobby is 10s or 60s depending on plan, safe buffer)
        const maxPagesPerRun = 20; // Safe limit

        const days = parseInt(searchParams.get('days') || '7');
        const defaultLookback = new Date();
        defaultLookback.setDate(defaultLookback.getDate() - days);
        const filterDateFrom = defaultLookback.toISOString().slice(0, 19).replace('T', ' ');

        console.log(`[Orders Sync] Syncing updates from: ${filterDateFrom} (Last ${days} days)`);

        let page = 1;
        let pagesProcessed = 0;
        let totalOrdersFetched = 0;
        let hasMore = true;
        let finalPagination = null;

        // 2. Loop Pages
        while (hasMore && pagesProcessed < maxPagesPerRun && (Date.now() - startTime) < maxTimeMs) {
            const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
            const limit = 100;

            const params = new URLSearchParams();
            params.append('apiKey', RETAILCRM_API_KEY);
            params.append('limit', String(limit));
            params.append('page', String(page));
            params.append('filter[statusUpdatedAtFrom]', filterDateFrom);
            params.append('paginator', 'page');

            // To ensure we get everything cleanly, we let standard ordering apply (usually by ID or CreatedAt desc)
            // Since we filter by date, eventually we will exhaust the list.

            const url = `${baseUrl}/api/v5/orders?${params.toString()}`;
            console.log(`[Orders Sync] Fetching Page ${page}:`, url);

            const { logAgentActivity } = await import('@/lib/agent-logger');
            await logAgentActivity('semen', 'working', `Проверяю страницу ${page} в RetailCRM...`);

            const res = await fetch(url);
            if (!res.ok) throw new Error(`RetailCRM API Error: ${res.status}`);

            const data = await res.json();
            if (!data.success) throw new Error(`RetailCRM Success False: ${JSON.stringify(data)}`);

            const orders = data.orders || [];
            finalPagination = data.pagination;

            if (orders.length === 0) {
                hasMore = false;
                break;
            }

            const eventsToUpsert: any[] = [];

            // 3. Transform
            for (const order of orders) {
                const phones = new Set<string>();
                const p1 = cleanPhone(order.phone); if (p1) phones.add(p1);
                const p2 = cleanPhone(order.additionalPhone); if (p2) phones.add(p2);

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

                eventsToUpsert.push({
                    id: order.id,
                    order_id: order.id,
                    created_at: order.createdAt,
                    updated_at: new Date().toISOString(),
                    number: order.number || String(order.id),
                    status: order.status,
                    site: order.site || null, // Add site field
                    event_type: 'snapshot',
                    manager_id: order.managerId ? String(order.managerId) : null,
                    phone: cleanPhone(order.phone) || null,
                    customer_phones: Array.from(phones),
                    totalsumm: order.totalSumm || 0,
                    raw_payload: order // Keep it full for now, ensure DB column is large enough or JSONB
                });
            }

            // 4. Upsert
            if (eventsToUpsert.length > 0) {
                const { error } = await supabase.rpc('upsert_orders_v2', {
                    orders_data: eventsToUpsert
                });

                if (error) {
                    console.error('RPC Upsert Error:', error);
                    throw error;
                }
            }

            // [NEW] Trigger Insight Agent for the first order of this page (background)
            if (eventsToUpsert.length > 0) {
                try {
                    const { runInsightAnalysis } = await import('@/lib/insight-agent');
                    runInsightAnalysis(eventsToUpsert[0].order_id).catch(e => console.error('[InsightAgent] Sync trigger failed:', e));
                } catch (e) { /* ignore import errors */ }
            }

            totalOrdersFetched += orders.length;
            pagesProcessed++;

            // 5. Next Page or Stop
            if (finalPagination && finalPagination.currentPage < finalPagination.totalPageCount) {
                page++;
            } else {
                hasMore = false;
            }
        }

        // Reset status to idle
        try {
            const { logAgentActivity } = await import('@/lib/agent-logger');
            await logAgentActivity('semen', 'idle', 'Архив обновлен. Все данные разложены по полкам.');
        } catch (e) { }

        // 6. Trigger Rule Engine Analysis
        return NextResponse.json({
            success: true,
            method: 'orders_time_window_sync',
            filter_date_from: filterDateFrom,
            last_page_processed: page,
            pages_processed: pagesProcessed,
            total_orders_fetched: totalOrdersFetched,
            total_pages_in_window: finalPagination ? finalPagination.totalPageCount : '?',
            has_more: hasMore
        });

    } catch (error: any) {
        console.error('RetailCRM Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
