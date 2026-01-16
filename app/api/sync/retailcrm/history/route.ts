
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 mins

export async function GET(request: Request) {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';

        let startDate = '2025-01-01 00:00:00';

        // 1. Determine start date
        if (!force) {
            const { data: lastEntry } = await supabase
                .from('order_history_log')
                .select('occurred_at')
                .order('occurred_at', { ascending: false })
                .limit(1)
                .single();

            if (lastEntry && lastEntry.occurred_at) {
                // Buffer of 1 hour potentially? Or just use the timestamp. 
                // RetailCRM /history endpoint uses `sinceId` or `startDate`.
                // `startDate` is easier for time-based.
                const d = new Date(lastEntry.occurred_at);
                startDate = d.toISOString().slice(0, 19).replace('T', ' ');
            }
        }

        console.log(`[History Sync] Starting from: ${startDate}`);

        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        const limit = 100;
        const startTime = Date.now();

        while (hasMore && (Date.now() - startTime) < 50000) {
            const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
            const params = new URLSearchParams();
            params.append('apiKey', RETAILCRM_API_KEY);
            params.append('limit', String(limit));
            params.append('page', String(page));
            params.append('filter[startDate]', startDate);

            const url = `${baseUrl}/api/v5/orders/history?${params.toString()}`;
            const res = await fetch(url);

            if (!res.ok) throw new Error(`RetailCRM History Error: ${res.status}`);

            const data = await res.json();
            if (!data.success) throw new Error(`RetailCRM Success False: ${JSON.stringify(data)}`);

            const history = data.history || [];
            if (history.length === 0) {
                hasMore = false;
                break;
            }

            const rowsToUpsert = [];

            for (const item of history) {
                // item structure: { id, order: { id }, field, oldValue, newValue, user: {}, createdAt }
                if (!item.order) continue; // Skip if no order link (shouldn't happen usually)

                rowsToUpsert.push({
                    retailcrm_history_id: item.id,
                    retailcrm_order_id: item.order.id,
                    field: item.field,
                    old_value: typeof item.oldValue === 'object' ? JSON.stringify(item.oldValue) : String(item.oldValue ?? ''),
                    new_value: typeof item.newValue === 'object' ? JSON.stringify(item.newValue) : String(item.newValue ?? ''),
                    user_data: item.user || null,
                    occurred_at: item.createdAt
                });
            }

            if (rowsToUpsert.length > 0) {
                const { error } = await supabase
                    .from('order_history_log')
                    .upsert(rowsToUpsert, { onConflict: 'retailcrm_history_id' });

                if (error) {
                    console.error('Upsert Error:', error);
                    throw error;
                }
                totalProcessed += rowsToUpsert.length;
            }

            const pagination = data.pagination;
            if (pagination && pagination.currentPage < pagination.totalPageCount) {
                page++;
            } else {
                hasMore = false;
            }
        }

        return NextResponse.json({
            success: true,
            processed: totalProcessed,
            lastPage: page
        });

    } catch (error: any) {
        console.error('History Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
