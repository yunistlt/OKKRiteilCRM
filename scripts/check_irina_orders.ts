import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '')
async function run() {
    const phoneSuffix = '0566489';
    console.log('Searching orders for phone suffix:', phoneSuffix);

    const { data: orders } = await supabase
        .from('orders')
        .select('id, manager_id, manager_name, phone, additional_phone, customer_phones, created_at')
        .or(`phone.ilike.%${phoneSuffix}%,additional_phone.ilike.%${phoneSuffix}%`)
        .order('created_at', { ascending: false });

    console.log('Orders found:', orders);

    const { data: events } = await supabase
        .from('raw_order_events')
        .select('retailcrm_order_id, phone, additional_phone, manager_id')
        .or(`phone_normalized.ilike.%${phoneSuffix}%,additional_phone_normalized.ilike.%${phoneSuffix}%`)
        .limit(10);

    if (events && events.length) {
        const orderIds = Array.from(new Set(events.map(e => e.retailcrm_order_id)));
        console.log('Orders from events:', orderIds);
    } else {
        console.log('No orders from events.');
    }

    // Find Irina's manager_id to be sure
    const { data: managers } = await supabase.from('okk_managers').select('*').ilike('name', '%Ирина%');
    console.log('Managers matching Irina:', managers);
}
run();
