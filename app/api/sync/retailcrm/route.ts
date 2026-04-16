import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import {
    fetchRetailCrmOrdersPage,
    getRetailCrmOrderCursor,
    upsertRetailCrmOrders,
} from '@/lib/retailcrm-orders';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const dynamic = 'force-dynamic';

export const maxDuration = 300;

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
        let maxCursorFound: Date | null = null;

        // 2. Loop Pages
        while (hasMore && pagesProcessed < maxPagesPerRun && (Date.now() - startTime) < maxTimeMs) {
            const limit = 100;
            console.log(`[Orders Sync] Fetching Page ${page} from ${filterDateFrom}`);

            const { logAgentActivity } = await import('@/lib/agent-logger');
            await logAgentActivity('semen', 'working', `Проверяю страницу ${page} в RetailCRM...`);

            const data = await fetchRetailCrmOrdersPage({
                page,
                limit,
                createdAtFrom: filterDateFrom,
            });

            const orders = data.orders || [];
            finalPagination = data.pagination;

            if (orders.length === 0) {
                hasMore = false;
                break;
            }

            const eventsToUpsert: any[] = [];

            // 3. Transform
            for (const order of orders) {
                const orderCursor = getRetailCrmOrderCursor(order);
                if (orderCursor && (!maxCursorFound || orderCursor > maxCursorFound)) {
                    maxCursorFound = orderCursor;
                }
                eventsToUpsert.push(order);
            }

            // 4. Upsert Orders
            if (eventsToUpsert.length > 0) {
                await upsertRetailCrmOrders(eventsToUpsert);
            }

            // Trigger Insight Agent for the first order
            if (eventsToUpsert.length > 0) {
                try {
                    const { runInsightAnalysis } = await import('@/lib/insight-agent');
                    runInsightAnalysis(eventsToUpsert[0].id).catch(e => console.error('[InsightAgent] Sync trigger failed:', e));
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
        if (maxCursorFound) {
            await supabase
                .from('sync_state')
                .upsert({
                    key: 'retailcrm_orders_sync',
                    value: maxCursorFound.toISOString(),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key' });
            console.log(`[Orders Sync] Updated sync_state to: ${maxCursorFound.toISOString()}`);
        }

        // Reset status to idle
        try {
            const { logAgentActivity } = await import('@/lib/agent-logger');
            await logAgentActivity('semen', 'idle', 'Архив обновлен. Все данные разложены по полкам.');
        } catch (e) { }

        return NextResponse.json({
            success: true,
            method: 'orders_state_based_sync',
            last_sync_stored: maxCursorFound?.toISOString() || 'unchanged',
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
