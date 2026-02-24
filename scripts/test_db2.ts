import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function main() {
    const { data, error } = await supabase
        .from('raw_order_events')
        .select('retailcrm_order_id, phone, additional_phone, phone_normalized, additional_phone_normalized')
        .eq('retailcrm_order_id', 51861)
        .limit(10);

    console.log("Events for 51861:", data, error);
}
main().catch(console.error);
