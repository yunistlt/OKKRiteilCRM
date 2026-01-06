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

        // 1. Determine Start Date (Time-based sync)
        let filterDateFrom = '2023-01-01 00:00:00';

        if (!forceResync) {
            const { data: lastOrder } = await supabase
                .from('orders')
                .select('created_at')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (lastOrder && lastOrder.created_at) {
                const d = new Date(lastOrder.created_at);
                d.setDate(d.getDate() - 1); // Go back 1 day to be safe (timezones, lateness)
                filterDateFrom = d.toISOString().slice(0, 19).replace('T', ' ');
                console.log(`[Orders Sync] Found recent order (${lastOrder.created_at}). Syncing from: ${filterDateFrom}`);
            } else {
                console.log('[Orders Sync] No recent orders found. Full sync from 2023.');
            }
        } else {
            console.log('[Orders Sync] Force resync requested. Syncing from 2023.');
        }

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
            params.append('filter[createdAtFrom]', filterDateFrom);
            params.append('paginator', 'page');

            // To ensure we get everything cleanly, we let standard ordering apply (usually by ID or CreatedAt desc)
            // Since we filter by date, eventually we will exhaust the list.

            const url = `${baseUrl}/api/v5/orders?${params.toString()}`;
            console.log(`[Orders Sync] Fetching Page ${page}:`, url);

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

            totalOrdersFetched += orders.length;
            pagesProcessed++;

            // 5. Next Page or Stop
            if (finalPagination && finalPagination.currentPage < finalPagination.totalPageCount) {
                page++;
            } else {
                hasMore = false;
            }
        }

        // 6. Trigger Rule Engine Analysis
        let ruleEngineResult = null;
        try {
            const { runRuleEngine } = await import('@/lib/rule-engine');
            // We analyze from the filter date to now
            const analysisEnd = new Date().toISOString();
            ruleEngineResult = await runRuleEngine(new Date(filterDateFrom).toISOString(), analysisEnd);
            console.log(`[Orders Sync] Rule Engine processed. Violations found: ${ruleEngineResult}`);
        } catch (reError) {
            console.error('[Orders Sync] Rule Engine trigger failed:', reError);
        }

        return NextResponse.json({
            success: true,
            method: 'orders_time_window_sync',
            filter_date_from: filterDateFrom,
            last_page_processed: page,
            pages_processed: pagesProcessed,
            total_orders_fetched: totalOrdersFetched,
            total_pages_in_window: finalPagination ? finalPagination.totalPageCount : '?',
            has_more: hasMore,
            rule_engine_violations: ruleEngineResult
        });

    } catch (error: any) {
        console.error('RetailCRM Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
