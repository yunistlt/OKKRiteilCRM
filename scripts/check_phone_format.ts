import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '')
async function run() {
    const { data: o } = await supabase.from('orders').select('id, manager_name, phone, additional_phone, customer_phones').eq('id', 51162);
    console.log('Order 51162 in orders table:', JSON.stringify(o, null, 2));

    const { data: m } = await supabase.from('retailcrm_orders').select('id, phone, customer').eq('id', 51162);
    console.log('Order 51162 in retailcrm_orders:', JSON.stringify(m, null, 2));
}
run();
