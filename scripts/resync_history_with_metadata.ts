import { supabase } from '../utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function resyncHistoryWithMetadata() {
    console.log('[Resync] Starting history resync from 2025-12-01...');

    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        throw new Error('Missing RetailCRM credentials');
    }

    const startDate = '2025-12-01 00:00:00';
    let page = 1;
    let totalProcessed = 0;
    let totalSaved = 0;

    while (true) {
        const url = `${RETAILCRM_URL}/api/v5/orders/history?apiKey=${RETAILCRM_API_KEY}&filter[startDate]=${encodeURIComponent(startDate)}&page=${page}&limit=100`;

        console.log(`[Resync] Fetching page ${page}...`);
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(`API returned error: ${data.errorMsg}`);
        }

        const history = data.history || [];
        const pagination = data.pagination;

        if (history.length === 0) {
            console.log('[Resync] No more events to process');
            break;
        }

        console.log(`[Resync] Processing ${history.length} events from page ${page}...`);

        // Process events with full metadata
        const processedEvents = history
            .filter((event: any) => event.order && event.order.id)
            .map((event: any) => ({
                retailcrm_order_id: event.order.id,
                event_type: event.field || 'unknown',
                occurred_at: event.createdAt,
                source: 'retailcrm',
                raw_payload: {
                    ...event, // Complete event data
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
            // Upsert with conflict resolution
            const { error: upsertError } = await supabase
                .from('raw_order_events')
                .upsert(processedEvents, {
                    onConflict: 'retailcrm_order_id, event_type, occurred_at, source',
                    ignoreDuplicates: false // Update existing records with new metadata
                });

            if (upsertError) {
                console.error('[Resync] Upsert error:', upsertError);
                throw upsertError;
            }

            totalSaved += processedEvents.length;
            console.log(`[Resync] ✓ Saved ${processedEvents.length} events (Total: ${totalSaved})`);
        }

        totalProcessed += history.length;

        // Check if we should continue
        if (pagination && page < pagination.totalPageCount) {
            page++;
            // Small delay to be nice to the API
            await new Promise(resolve => setTimeout(resolve, 100));
        } else {
            break;
        }

        // Safety limit
        if (page > 1000) {
            console.log('[Resync] Reached safety limit of 1000 pages');
            break;
        }
    }

    console.log(`\n[Resync] Complete!`);
    console.log(`Total events processed: ${totalProcessed}`);
    console.log(`Total events saved: ${totalSaved}`);
}

// Run the script
resyncHistoryWithMetadata()
    .then(() => {
        console.log('\n✓ Resync completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n✗ Resync failed:', error);
        process.exit(1);
    });
