import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
    const orderId = 51162;
    console.log(`Checking manager for order ${orderId}...`);

    const { data: o1 } = await supabase.from('orders').select('id, manager_id, manager_name').eq('id', orderId);
    console.log('orders matching id:', o1);

    const { data: o3 } = await supabase.from('raw_order_events')
        .select('manager_id, manager_name, event_type, occurred_at')
        .eq('retailcrm_order_id', orderId)
        .order('occurred_at', { ascending: false })
        .limit(5);
    console.log('recent raw events:', o3);
}
main()
