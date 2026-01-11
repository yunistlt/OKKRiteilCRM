
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function deepSearchCommunications() {
    console.log('🔍 Deep searching raw_order_events for communication data...');

    // Check for "comment" related events that might be from a customer (not manager)
    const { data: events, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .or('event_type.ilike.%comment%,event_type.ilike.%note%,event_type.ilike.%customer%')
        .limit(20);

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    console.log(`✅ Found ${events?.length || 0} candidate events.`);
    events?.forEach(e => {
        const payloadStr = JSON.stringify(e.raw_payload);
        if (payloadStr.includes('message') || payloadStr.includes('email') || payloadStr.includes('text')) {
            console.log(`[FOUND] Event ID: ${e.id}, Type: ${e.event_type}`);
            console.log('--- Payload Snippet ---');
            console.log(payloadStr.slice(0, 500));
        }
    });

    // Also check order_metrics
    console.log('\n🔍 Checking order_metrics.full_order_context...');
    const { data: metrics } = await supabase
        .from('order_metrics')
        .select('full_order_context')
        .limit(1);

    if (metrics && metrics[0]) {
        console.log('Keys in full_order_context:', Object.keys(metrics[0].full_order_context || {}));
    }
}

deepSearchCommunications();
