
import { supabase } from '@/utils/supabase';

async function checkTypes() {
    console.log('Checking column types in database...');

    // We can't query information_schema directly via supabase-js helper easily unless we use rpc or raw query if enabled.
    // But we can try to guess by fetching one row and checking typeof, OR
    // if we have a direct postgres connection string (we don't from here usually).

    // Better approach: Use the 'rpc' capability if available, or just inspect the JSON values returned.
    // Actually, asking Supabase/PostgREST for OpenAPI spec is one way, but too complex.

    // Let's just fetch one row from each and print the JS type.
    // This is a proxy for DB type. 
    // If JS sees 'number', it's int/float. If 'string', it's text/varchar (or bigint sometimes).

    const { data: order } = await supabase.from('orders').select('order_id').limit(1).single();
    const { data: event } = await supabase.from('raw_order_events').select('retailcrm_order_id').limit(1).single();

    console.log('--- TYPES CHECK ---');
    if (order) {
        console.log(`orders.order_id value: ${order.order_id} (Type: ${typeof order.order_id})`);
    } else {
        console.log('orders table is empty?');
    }

    if (event) {
        console.log(`raw_order_events.retailcrm_order_id value: ${event.retailcrm_order_id} (Type: ${typeof event.retailcrm_order_id})`);
    } else {
        console.log('raw_order_events table is empty?');
    }
}

checkTypes();
