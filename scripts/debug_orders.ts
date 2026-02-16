
import { supabase } from '../utils/supabase';

async function debug() {
    const orderIds = [51654, 51629, 51610];
    console.log(`--- Checking events for orders: ${orderIds.join(', ')} ---`);

    const { data: events, error: err } = await supabase
        .from('raw_order_events')
        .select('*')
        .in('retailcrm_order_id', orderIds)
        .order('occurred_at', { ascending: false });

    if (err) {
        console.error('Error:', err);
        return;
    }

    console.log(`Found ${events.length} events.`);
    events.forEach(e => {
        const payload = e.raw_payload;
        console.log(`[${e.occurred_at}] Order ${e.retailcrm_order_id}: ${e.event_type} (${payload?.field} -> ${JSON.stringify(payload?.newValue)})`);
    });

    const { data: metrics } = await supabase
        .from('order_metrics')
        .select('*')
        .in('retailcrm_order_id', orderIds);

    console.log('\n--- Metrics ---');
    metrics?.forEach(m => {
        console.log(`Order ${m.retailcrm_order_id}: Status ${m.current_status}, Manager ${m.manager_id}`);
    });
}

debug();
