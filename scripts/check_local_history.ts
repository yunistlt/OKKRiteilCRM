
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkLocalHistory() {
    const orderId = 48136;
    console.log(`🔍 Checking local raw_order_events for order #${orderId}...`);

    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .eq('retailcrm_order_id', orderId)
        .order('occurred_at', { ascending: true });

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log(`✅ Found ${data.length} events:`);
        data.forEach(event => {
            console.log(`[${event.occurred_at}] ${event.event_type}`);
            if (event.event_type === 'manager_comment') {
                console.log(`  Old: ${event.raw_payload?.oldValue}`);
                console.log(`  New: ${event.raw_payload?.newValue}`);
            }
        });
    } else {
        console.log('No local history entries found for this order.');
    }
}

checkLocalHistory();
