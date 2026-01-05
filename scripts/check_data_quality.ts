
import { supabase } from '@/utils/supabase';

async function checkRecentDataQuality() {
    console.log('Checking recent events + metrics existence...');
    const { data: recent, error } = await supabase
        .from('raw_order_events')
        .select('event_id, retailcrm_order_id, event_type, raw_payload, occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error:', error);
        return;
    }

    for (const e of recent) {
        console.log(`--- Event ${e.event_id} ---`);
        console.log(`Order ID: ${e.retailcrm_order_id}, Type: ${e.event_type}, Time: ${e.occurred_at}`);
        console.log(`Payload Keys: ${e.raw_payload ? Object.keys(e.raw_payload) : 'NULL'}`);

        // Check if metric exists
        const { data: metric } = await supabase
            .from('order_metrics')
            .select('retailcrm_order_id')
            .eq('retailcrm_order_id', e.retailcrm_order_id)
            .single();

        console.log(`Metric exists: ${!!metric}`);
    }
}

checkRecentDataQuality();
