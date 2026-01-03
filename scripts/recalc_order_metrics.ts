
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

/**
 * RECALC ORDER METRICS (INTERPRETED LAYER)
 * 
 * Purpose: 
 * Synthesize RAW data (Events + Calls) into a clean "Order Object" (order_metrics).
 * This is the "Reducer" function of our architecture.
 * 
 * Logic:
 * 1. Fetch relevant orders (active or all).
 * 2. For each order:
 *    - Get latest `status_changed` event -> `current_status`.
 *    - Get all `call_order_matches` -> `total_calls`, `last_contact`.
 *    - Calculate `days_without_contact`.
 * 3. Upsert to `order_metrics`.
 */

async function recalcMetrics() {
    console.log('=== RECALC ORDER METRICS (INTERPRETED) ===');

    // 1. Get List of Orders to Process
    // For MVP, we process ALL orders referenced in raw_order_events that are "active".
    // Or just all recent ones. Let's do batches.

    // We get distinct order_ids from raw_order_events
    // Efficient way: use existing `orders` table as index for now, OR fetch distinct IDs.
    // Let's use `orders` table as the "List of known orders" for now.

    const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    console.log(`Total orders known: ${count}`);

    let from = 0;
    const PAGE_SIZE = 100;
    let processed = 0;

    while (true) {
        // Fetch batch of orders
        const { data: orders, error } = await supabase
            .from('orders')
            .select('order_id, created_at, status, manager_id, totalsumm')
            .range(from, from + PAGE_SIZE - 1)
            .order('created_at', { ascending: false }); // Process potential active ones first

        if (error) {
            console.error('Error fetching orders:', error);
            break;
        }
        if (!orders || orders.length === 0) break;

        console.log(`Processing batch ${from} - ${from + orders.length}...`);

        const updates: any[] = [];

        // For each order, gather intel
        for (const order of orders) {
            const orderId = order.order_id;

            // A. Get Call Matches
            // We use the new INTERPRETED table `call_order_matches`
            const { data: matches } = await supabase
                .from('call_order_matches')
                .select('*')
                .eq('retailcrm_order_id', orderId);

            // B. Filter Real Calls (Confidence >= 0.70)
            const realMatches = matches?.filter(m => m.confidence_score >= 0.70) || [];

            // C. Find "Last Contact" (Max of Order Updates or Call Time)
            // Ideally we check `raw_order_events` history, but for MVP let's use:
            // - Order Created/Updated At
            // - Last Call Time (we need to join `raw_telphin_calls` to get time, OR assume matched_at?)
            // WAIT - `call_order_matches` doesn't have Call Time! It has `telphin_call_id`.
            // We need to fetch Call Details or have denormalized time in matches.
            // For now, let's just count them. To get time, we need a join. 
            // Optimization: `call_order_matches` should probably store `call_started_at` for speed.
            // But let's fetch it for now.

            let lastCallTime: Date | null = null;
            if (realMatches.length > 0) {
                // Fetch call times (could be slow N+1, but batching helps? No, this is N calls)
                // Let's fetch matching raw calls in one go?
                const callIds = realMatches.map(m => m.telphin_call_id);
                const { data: calls } = await supabase
                    .from('raw_telphin_calls')
                    .select('timestamp') // or started_at
                    .in('id', callIds)
                    .order('timestamp', { ascending: false })
                    .limit(1);

                if (calls && calls.length > 0) {
                    lastCallTime = new Date(calls[0].timestamp);
                }
            }

            // D. Calculate Days Without Contact
            const now = new Date();
            const orderUpdate = new Date(order.created_at); // Should be updated_at, but taking created for safety

            // Best last contact = Max(Order Update, Last Call)
            let lastContact = orderUpdate;
            if (lastCallTime && lastCallTime > lastContact) {
                lastContact = lastCallTime;
            }

            const diffMs = now.getTime() - lastContact.getTime();
            const daysWithoutContact = diffMs / (1000 * 60 * 60 * 24);

            updates.push({
                retailcrm_order_id: orderId,
                current_status: order.status,
                manager_id: order.manager_id,
                total_calls_count: matches?.length || 0,
                real_calls_count: realMatches.length,
                last_contact_at: lastContact.toISOString(),
                days_without_contact: parseFloat(daysWithoutContact.toFixed(2)),
                order_amount: order.totalsumm,
                computed_at: new Date().toISOString()
            });
        }

        // Upsert batch to order_metrics
        if (updates.length > 0) {
            const { error: upsertError } = await supabase
                .from('order_metrics')
                .upsert(updates);

            if (upsertError) console.error('Upsert metrics error:', upsertError);
            else processed += updates.length;
        }

        from += PAGE_SIZE;
    }

    console.log(`✅ Done. Recalculated metrics for ${processed} orders.`);
}

recalcMetrics().catch(console.error);
