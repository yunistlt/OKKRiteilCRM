import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { matchCallToOrders } from '../lib/call-matching'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '')

async function run() {
    const { data } = await supabase.from('raw_telphin_calls').select('*').eq('telphin_call_id', 'B32E7F072E924CC4AA71695259F76497').limit(1)
    if (data && data.length > 0) {
        const call = data[0]
        console.log('Testing call from', call.raw_payload?.from_screen_name)
        const matches = await matchCallToOrders(call)
        console.log('Matches:', JSON.stringify(matches, null, 2))
    }
}
run();
