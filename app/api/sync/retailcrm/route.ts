import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL; // Support both
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY;

export const maxDuration = 300;

export async function GET(request: Request) {
    if (!RETAILCRM_URL || !RETAILCRM_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const forceResync = searchParams.get('force') === 'true';

        // 1. Get persisted cursor (bookmark)
        let storageKey = 'retailcrm_history_id_v2'; // New key for the new schema
        let currentCursor: number | null = null;

        if (!forceResync) {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', storageKey)
                .single();

            if (state?.value) {
                currentCursor = parseInt(state.value, 10);
            }
        } else {
            console.log('[Sync] Force resync requested. Resetting cursor.');
        }

        const defaultStart = '2025-12-01 00:00:00';
        console.log(`[Sync] Starting. Cursor: ${currentCursor ?? 'None (using date ' + defaultStart + ')'}`);

        let processedEventsCount = 0;
        let lastHistoryId: number | null = currentCursor;
        let hasMore = true;
        let loopCount = 0;
        const MAX_LOOPS = 20;

        while (hasMore && loopCount < MAX_LOOPS) {
            loopCount++;

            let histUrl = `${RETAILCRM_URL}/api/v5/orders/history?apiKey=${RETAILCRM_KEY}&limit=100`;

            if (lastHistoryId) {
                histUrl += `&filter[sinceId]=${lastHistoryId}`;
            } else {
                histUrl += `&startDate=${encodeURIComponent(defaultStart)}`;
            }

            const res = await fetch(histUrl);
            if (!res.ok) {
                console.error(`History fetch error: ${await res.text()}`);
                break;
            }

            const hData = await res.json();
            if (!hData.success) {
                console.error('History API error:', hData);
                break;
            }

            const history = hData.history || [];
            if (history.length === 0) {
                hasMore = false;
                break;
            }

            // 1. Extract Unique Order IDs from this batch of history
            const batchOrderIds = new Set<string>();
            history.forEach((h: any) => {
                if (h.order && h.order.id) batchOrderIds.add(String(h.order.id));
                if (h.id) lastHistoryId = h.id;
            });

            // 2. Fetch Fresh Details for these orders (Enrichment)
            const orderDetailsMap = new Map<string, any>();
            if (batchOrderIds.size > 0) {
                const ids = Array.from(batchOrderIds);
                const CHUNK_SIZE = 50;
                for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
                    const chunkIds = ids.slice(i, i + CHUNK_SIZE);
                    const idParams = chunkIds.map(id => `filter[ids][]=${id}`).join('&');
                    const ordersUrl = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_KEY}&limit=100&${idParams}`;

                    const oRes = await fetch(ordersUrl);
                    if (oRes.ok) {
                        const oData = await oRes.json();
                        if (oData.success) {
                            (oData.orders || []).forEach((o: any) => {
                                orderDetailsMap.set(String(o.id), o);
                            });
                        }
                    }
                }
            }

            // 3. Construct "Event Rows" for DB
            // We iterate strictly through HISTORY (the events)
            const eventsToUpsert: any[] = [];

            history.forEach((event: any) => {
                const orderId = String(event.order?.id);
                // Get full enriched data if available, or fallback to the mini-order object inside history
                const fullOrder = orderDetailsMap.get(orderId) || event.order || {};

                // FILTER: Ignore orders created before 2023 (Legacy Data)
                if (fullOrder.createdAt) {
                    const createdYear = new Date(fullOrder.createdAt).getFullYear();
                    // Careful check to allow late 2022 if needed, but sticking to 2023 as requested
                    if (createdYear < 2023) return;
                }

                // Phones extraction
                const normalizePhone = (p: any) => p ? String(p).replace(/[^\d]/g, '') : null;
                const phoneSet = new Set<string>();

                if (fullOrder.phone) phoneSet.add(normalizePhone(fullOrder.phone)!);
                if (fullOrder.additionalPhone) phoneSet.add(normalizePhone(fullOrder.additionalPhone)!);
                if (fullOrder.customer && Array.isArray(fullOrder.customer.phones)) {
                    fullOrder.customer.phones.forEach((p: any) => p.number && phoneSet.add(normalizePhone(p.number)!));
                }
                if (fullOrder.contact && Array.isArray(fullOrder.contact.phones)) {
                    fullOrder.contact.phones.forEach((p: any) => p.number && phoneSet.add(normalizePhone(p.number)!));
                }
                const phones = Array.from(phoneSet).filter(Boolean);

                eventsToUpsert.push({
                    id: event.id,                         // Primary Key: EVENT ID
                    order_id: fullOrder.id ? parseInt(fullOrder.id) : null, // CRM Order ID
                    number: fullOrder.externalId || fullOrder.number,
                    status: fullOrder.status,             // Snapshot of current status
                    event_type: event.type,               // 'status_changed', 'api_update', etc.
                    event_field: event.field,             // specific field changed if available
                    created_at: event.createdAt,          // TIME OF EVENT
                    manager_id: String(fullOrder.managerId),
                    phone: phones[0] || null,
                    customer_phones: phones,
                    totalsumm: fullOrder.totalSumm || 0,
                    raw_payload: fullOrder                // Full snapshot for matching/debug
                });
            });

            if (eventsToUpsert.length > 0) {
                const { error } = await supabase.from('orders').upsert(eventsToUpsert);
                if (error) {
                    console.error('Supabase Upsert Error:', error);
                } else {
                    processedEventsCount += eventsToUpsert.length;
                }
            }

            if (history.length < 100) hasMore = false;
        }

        // 4. Save Cursor
        if (lastHistoryId) {
            await supabase.from('sync_state').upsert({
                key: storageKey,
                value: String(lastHistoryId),
                updated_at: new Date().toISOString()
            });
        }

        return NextResponse.json({
            success: true,
            method: 'event_log_stream',
            events_processed: processedEventsCount,
            saved_cursor: lastHistoryId,
            has_more: hasMore
        });

    } catch (error: any) {
        console.error('Sync Error Full:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
