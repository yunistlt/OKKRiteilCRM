import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
    console.log('[Resync Metadata] Starting from 2025-12-01...');

    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        return NextResponse.json({ error: 'Missing RetailCRM credentials' }, { status: 500 });
    }

    try {
        const startDate = '2025-12-01 00:00:00';
        let page = 1;
        let totalProcessed = 0;
        let totalSaved = 0;
        const maxPages = 50; // Limit for safety

        while (page <= maxPages) {
            const url = `${RETAILCRM_URL}/api/v5/orders/history?apiKey=${RETAILCRM_API_KEY}&filter[startDate]=${encodeURIComponent(startDate)}&page=${page}&limit=100`;

            console.log(`[Resync] Page ${page}...`);
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(`API Error: ${data.errorMsg}`);
            }

            const history = data.history || [];
            const pagination = data.pagination;

            if (history.length === 0) break;

            // Process with full metadata
            const processedEvents = history
                .filter((event: any) => event.order && event.order.id)
                .map((event: any) => ({
                    retailcrm_order_id: event.order.id,
                    event_type: event.field || 'unknown',
                    occurred_at: event.createdAt,
                    source: 'retailcrm',
                    raw_payload: {
                        ...event,
                        _sync_metadata: {
                            api_createdAt: event.createdAt,
                            order_statusUpdatedAt: event.order?.statusUpdatedAt,
                            order_createdAt: event.order?.createdAt,
                            synced_at: new Date().toISOString(),
                            resync_batch: '2025-12-01'
                        }
                    },
                    manager_id: event.user ? event.user.id : null,
                }));

            if (processedEvents.length > 0) {
                // Deduplicate events by unique key before upserting
                const uniqueEvents = new Map();
                processedEvents.forEach((event: any) => {
                    const key = `${event.retailcrm_order_id}_${event.event_type}_${event.occurred_at}_${event.source}`;
                    uniqueEvents.set(key, event);
                });

                const deduplicatedEvents = Array.from(uniqueEvents.values());
                console.log(`[Resync] Deduplicating: ${processedEvents.length} → ${deduplicatedEvents.length} unique events`);

                const { error: upsertError } = await supabase
                    .from('raw_order_events')
                    .upsert(deduplicatedEvents, {
                        onConflict: 'retailcrm_order_id, event_type, occurred_at, source',
                        ignoreDuplicates: false
                    });

                if (upsertError) {
                    console.error('[Resync] Error:', upsertError);
                    throw upsertError;
                }

                totalSaved += deduplicatedEvents.length;
            }

            totalProcessed += history.length;

            if (!pagination || page >= pagination.totalPageCount) break;
            page++;
        }

        return NextResponse.json({
            success: true,
            total_processed: totalProcessed,
            total_saved: totalSaved,
            pages: page - 1
        });

    } catch (error: any) {
        console.error('[Resync] Failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
