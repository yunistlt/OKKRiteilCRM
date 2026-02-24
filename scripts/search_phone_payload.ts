import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '')
async function run() {
    const { data, error } = await supabase
        .from('raw_order_events')
        .select('retailcrm_order_id, manager_id, event_type')
        .textSearch('raw_payload::text', "'0566489'", { type: 'plain' })
        .limit(20);

    if (error) {
        console.error('Error:', error);
    } else {
        // If textSearch fails, we'll try something else
        console.log('Found with textSearch:', data?.map(d => d.retailcrm_order_id));
    }
}
run();
