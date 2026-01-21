import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

// Environment variables
const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow 5 minutes execution for lengthy syncs

export async function GET() {
    console.log('[History Sync] Starting (Loop Mode)...');

    try {
        let startDate = null;

        // Find last sync time from NEW table
        const { data: lastEntry } = await supabase
            .from('raw_order_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single();

        if (lastEntry) {
            startDate = lastEntry.occurred_at;
            console.log(`[History Sync] Resuming from ${startDate}`);
        } else {
            const d = new Date();
            d.setDate(d.getDate() - 7);
            startDate = d.toISOString();
            console.log(`[History Sync] First run, starting from ${startDate}`);
        }

        const dObj = new Date(startDate);
        const formattedDate = dObj.toISOString().slice(0, 19).replace('T', ' ');

        let page = 1;
        let totalPages = 1;
        let totalSaved = 0;
        let totalFetched = 0;

        // --- PAGINATION LOOP ---
        do {
            const url = `${RETAILCRM_URL}/api/v5/orders/history?apiKey=${RETAILCRM_API_KEY}&filter[startDate]=${encodeURIComponent(formattedDate)}&page=${page}&limit=100`;

            console.log(`[History Sync] Fetching page ${page}...`);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`CRM API Error: ${response.status}`);

            const data = await response.json();
            if (!data.success) throw new Error(`CRM Error: ${data.errorMsg}`);

            const history = data.history || [];
            const pagination = data.pagination;

            totalPages = pagination.totalPageCount;
            totalFetched += history.length;

            if (history.length === 0) break;

            const safeStringify = (val: any) => {
                if (val === null || val === undefined) return null;
                if (typeof val === 'object') {
                    if (val.code) return val.code;
                    return JSON.stringify(val);
                }
                return String(val);
            };

            const processedEvents = history
                .filter((event: any) => event.order && event.order.id)
                .map((event: any) => {
                    const orderData = event.order || {};
                    const phone = orderData.phone || null;
                    const additionalPhone = orderData.additionalPhone || null;

                    // Simple normalization (digits only)
                    const normalize = (p: any) => p ? String(p).replace(/[^\d]/g, '') : null;

                    return {
                        retailcrm_order_id: event.order.id,
                        event_type: event.field || 'unknown',
                        occurred_at: event.createdAt,
                        source: 'retailcrm',
                        phone: phone,
                        phone_normalized: normalize(phone),
                        additional_phone: additionalPhone,
                        additional_phone_normalized: normalize(additionalPhone),
                        manager_id: event.user ? event.user.id : (orderData.managerId || null),
                        raw_payload: {
                            ...event,
                            _sync_metadata: {
                                api_createdAt: event.createdAt,
                                order_statusUpdatedAt: orderData.statusUpdatedAt,
                                synced_at: new Date().toISOString()
                            }
                        }
                    };
                });

            if (processedEvents.length > 0) {
                const { error: upsertError } = await supabase
                    .from('raw_order_events')
                    .upsert(processedEvents, {
                        // Match the UNIQUE constraint from 20260103_raw_layer.sql
                        onConflict: 'retailcrm_order_id, event_type, occurred_at, source',
                        ignoreDuplicates: true
                    });

                if (upsertError) {
                    // Self-healing: If failing due to missing order_metrics/orders (FK), try to fetch the order explicitly
                    if (upsertError.code === '23503') {
                        console.warn('[History Sync] FK Violation. Attempting to auto-fix missing orders...');

                        // Collect missing Order IDs from this batch
                        const orderIds = Array.from(new Set(processedEvents.map((e: any) => e.retailcrm_order_id)));

                        for (const missedId of orderIds) {
                            try {
                                // 1. Fetch single order from RetailCRM
                                const singleOrderUrl = `${RETAILCRM_URL}/api/v5/orders/${missedId}?apiKey=${RETAILCRM_API_KEY}`;
                                const soRes = await fetch(singleOrderUrl);
                                const soData = await soRes.json();

                                if (soData.success && soData.order) {
                                    // 2. Upsert via RPC (same as retailcrm sync)
                                    // We construct a mini-batch of 1
                                    const o = soData.order;
                                    const phones = new Set<string>();
                                    // ... mini-utils ...
                                    const clph = (v: any) => v ? String(v).replace(/[^\d+]/g, '') : '';

                                    const p1 = clph(o.phone); if (p1) phones.add(p1);
                                    if (o.additionalPhone) { const p2 = clph(o.additionalPhone); if (p2) phones.add(p2); }
                                    if (o.customer?.phones) o.customer.phones.forEach((p: any) => { const x = clph(p.number); if (x) phones.add(x) });

                                    const payload = [{
                                        id: o.id,
                                        order_id: o.id,
                                        created_at: o.createdAt,
                                        updated_at: new Date().toISOString(),
                                        number: o.number || String(o.id),
                                        status: o.status,
                                        site: o.site || null,
                                        event_type: 'snapshot',
                                        manager_id: o.managerId ? String(o.managerId) : null,
                                        phone: clph(o.phone) || null,
                                        customer_phones: Array.from(phones),
                                        totalsumm: o.totalSumm || 0,
                                        raw_payload: o
                                    }];

                                    await supabase.rpc('upsert_orders_v2', { orders_data: payload });
                                    // console.log(`[History Sync] Auto-healed order ${o.id}`);
                                }
                            } catch (healErr) {
                                console.error(`[History Sync] Failed to heal order ${missedId}`, healErr);
                            }
                        }

                        // Retry the batch upsert once
                        const { error: retryError } = await supabase
                            .from('raw_order_events')
                            .upsert(processedEvents, {
                                onConflict: 'retailcrm_order_id, event_type, occurred_at, source',
                                ignoreDuplicates: true
                            });

                        if (retryError) {
                            console.error('[History Sync] Retry failed, skipping batch:', retryError);
                            // Do not throw, allow partial progress if possible? No, strict logging.
                        } else {
                            console.log('[History Sync] Retry successful after self-healing.');
                            totalSaved += processedEvents.length;
                        }

                    } else {
                        console.error('[History Sync] DB Error:', upsertError);
                        throw new Error(upsertError.message);
                    }
                } else {
                    totalSaved += processedEvents.length;
                }

                // --- NEW: Propagate Status Changes to Orders Table ---
                const statusChanges = history
                    .filter((event: any) => event.field === 'status' && event.order && event.order.id)
                    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

                const latestStatusMap = new Map<number, { status: string, time: string }>();
                statusChanges.forEach((event: any) => {
                    latestStatusMap.set(event.order.id, {
                        status: safeStringify(event.newValue) || 'unknown',
                        time: event.createdAt
                    });
                });

                if (latestStatusMap.size > 0) {
                    console.log(`[History Sync] Propagating ${latestStatusMap.size} status updates to orders table...`);

                    // Use forEach to avoid downlevelIteration issues with entries()
                    const updatePromises: any[] = [];
                    latestStatusMap.forEach((data, orderId) => {
                        updatePromises.push(
                            supabase
                                .from('orders')
                                .update({
                                    status: data.status,
                                    updated_at: data.time
                                })
                                .eq('id', orderId)
                        );
                    });

                    if (updatePromises.length > 0) {
                        await Promise.all(updatePromises);
                    }
                }
            }

            page++;
            // Optional: small delay to be nice to API?
            // await new Promise(r => setTimeout(r, 100)); 

        } while (page <= totalPages);

        console.log(`[History Sync] Completed. Fetched: ${totalFetched}, Saved: ${totalSaved}`);

        return NextResponse.json({
            success: true,
            fetched_events: totalFetched,
            saved_events: totalSaved,
            pages_processed: page - 1
        });

    } catch (error: any) {
        console.error('[History Sync] Failed:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
