import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
    const { data: events } = await supabase
        .from('raw_order_events')
        .select('manager_id, phone, additional_phone, manager_name')
        .eq('retailcrm_order_id', 51162)
        .not('manager_id', 'is', null)
        .limit(1)
    console.log('Order Events:', events);
}
main()
