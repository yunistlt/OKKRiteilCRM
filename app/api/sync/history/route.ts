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

        // Find last sync time
        const { data: lastEntry } = await supabase
            .from('order_history')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (lastEntry) {
            startDate = lastEntry.created_at;
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
                .map((event: any) => ({
                    order_id: event.order.id,
                    field_name: event.field || 'unknown',
                    old_value: safeStringify(event.oldValue),
                    new_value: safeStringify(event.newValue),
                    manager_id: event.user ? event.user.id : null,
                    created_at: event.createdAt,
                    source: 'retailcrm'
                }));

            if (processedEvents.length > 0) {
                const { error: upsertError } = await supabase
                    .from('order_history')
                    .upsert(processedEvents, {
                        onConflict: 'order_id, field_name, created_at',
                        ignoreDuplicates: true
                    });

                if (upsertError) {
                    console.error('[History Sync] DB Error:', upsertError);
                    throw new Error(upsertError.message);
                }
                totalSaved += processedEvents.length;

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
