import { config } from 'dotenv';
config({ path: '.env.local' });
import { supabase } from './utils/supabase';
import { matchCallToOrders } from './lib/call-matching';

async function test() {
    const { data, error } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .eq('telphin_call_id', 'E1FF61AE81314D4186EDBFE1A3731EEE')
        .single();

    console.log("Found call:", data?.telphin_call_id);
    if (data) {
        const matches = await matchCallToOrders(data);
        console.log("Matches:", matches);
    }
}
test();
