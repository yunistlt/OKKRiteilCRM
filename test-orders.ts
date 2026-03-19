import { config } from 'dotenv';
config({ path: '.env.local' });
import { supabase } from './utils/supabase';

async function run() {
    const { data } = await supabase.from('orders').select('order_id, phone, customer_phones, created_at').or('phone.ilike.%9299259612%');
    console.log("Orders:", data);
    const { data: matches } = await supabase.from('call_order_matches').select('*').eq('telphin_call_id', 'E1FF61AE81314D4186EDBFE1A3731EEE');
    console.log("DB Matches for E1FF...:", matches);
}
run();
