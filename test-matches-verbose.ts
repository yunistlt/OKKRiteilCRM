import { config } from 'dotenv';
config({ path: '.env.local' });
import { matchCallToOrders } from './lib/call-matching';
import { supabase } from './utils/supabase';

async function test() {
    const { data: call } = await supabase.from('raw_telphin_calls').select('*').eq('telphin_call_id', 'E1FF61AE81314D4186EDBFE1A3731EEE').single();
    if (call) {
        const matches = await matchCallToOrders(call);
        console.log("Matches:", JSON.stringify(matches, null, 2));
    }
}
test();
