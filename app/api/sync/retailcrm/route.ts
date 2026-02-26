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
        const maxTimeMs = 50000;
        const maxPagesPerRun = 20;

        let filterDateFrom = '';

        // 1. Determine Start Date from sync_state
        if (!forceResync) {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', 'retailcrm_orders_sync')
                .single();

            if (state?.value) {
                const lastSync = new Date(state.value);
                // 10 minute overlap to be safe against race conditions or slight delay in CRM records
                lastSync.setMinutes(lastSync.getMinutes() - 10);
                filterDateFrom = lastSync.toISOString().slice(0, 19).replace('T', ' ');
            }
        }

        // Fallback to default lookback if no state found or force resync
        if (!filterDateFrom) {
            const days = parseInt(searchParams.get('days') || '2');
            const defaultLookback = new Date();
            defaultLookback.setDate(defaultLookback.getDate() - days);
            filterDateFrom = defaultLookback.toISOString().slice(0, 19).replace('T', ' ');
        }

        console.log(`[Orders Sync] Syncing updates from: ${filterDateFrom}`);

        let page = 1;
        let pagesProcessed = 0;
        let totalOrdersFetched = 0;
        let hasMore = true;
        let finalPagination = null;
        let maxUpdatedAtFound: Date | null = null;

        // 2. Loop Pages
        while (hasMore && pagesProcessed < maxPagesPerRun && (Date.now() - startTime) < maxTimeMs) {
            const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
            const limit = 100;

            const params = new URLSearchParams();
            params.append('apiKey', RETAILCRM_API_KEY);
            params.append('limit', String(limit));
            params.append('page', String(page));
            params.append('filter[updatedAtFrom]', filterDateFrom);

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
                // Tracking the most recent updatedAt in this batch
                if (order.updatedAt) {
                    const orderUpdateDate = new Date(order.updatedAt);
                    if (!maxUpdatedAtFound || orderUpdateDate > maxUpdatedAtFound) {
                        maxUpdatedAtFound = orderUpdateDate;
                    }
                }

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
                    updated_at: new Date().toISOString(), // This is system entry update time, RetailCRM's updatedAt is in raw_payload
                    number: order.number || String(order.id),
                    status: order.status,
                    site: order.site || null,
                    event_type: 'snapshot',
                    manager_id: order.managerId ? String(order.managerId) : null,
                    phone: cleanPhone(order.phone) || null,
                    customer_phones: Array.from(phones),
                    totalsumm: order.totalSumm || 0,
                    raw_payload: order
                });
            }

            // 4. Upsert Orders
            if (eventsToUpsert.length > 0) {
                const { error } = await supabase.rpc('upsert_orders_v2', {
                    orders_data: eventsToUpsert
                });

                if (error) {
                    console.error('RPC Upsert Error:', error);
                    throw error;
                }
            }

            // Trigger Insight Agent for the first order
            if (eventsToUpsert.length > 0) {
                try {
                    const { runInsightAnalysis } = await import('@/lib/insight-agent');
                    runInsightAnalysis(eventsToUpsert[0].order_id).catch(e => console.error('[InsightAgent] Sync trigger failed:', e));
                } catch (e) { }
            }

            totalOrdersFetched += orders.length;
            pagesProcessed++;

            if (finalPagination && finalPagination.currentPage < finalPagination.totalPageCount) {
                page++;
            } else {
                hasMore = false;
            }
        }

        // 5. Update sync_state if we actually found and processed something
        if (maxUpdatedAtFound) {
            await supabase
                .from('sync_state')
                .upsert({
                    key: 'retailcrm_orders_sync',
                    value: maxUpdatedAtFound.toISOString(),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key' });
            console.log(`[Orders Sync] Updated sync_state to: ${maxUpdatedAtFound.toISOString()}`);
        }

        // Reset status to idle
        try {
            const { logAgentActivity } = await import('@/lib/agent-logger');
            await logAgentActivity('semen', 'idle', 'Архив обновлен. Все данные разложены по полкам.');
        } catch (e) { }

        return NextResponse.json({
            success: true,
            method: 'orders_state_based_sync',
            last_sync_stored: maxUpdatedAtFound?.toISOString() || 'unchanged',
            filter_date_from: filterDateFrom,
            pages_processed: pagesProcessed,
            total_orders_fetched: totalOrdersFetched,
            has_more: hasMore
        });

    } catch (error: any) {
        console.error('RetailCRM Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
