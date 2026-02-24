import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function main() {
    const suffix = '2790489';
    const { data, error } = await supabase
        .from('orders')
        .select('id, phone, raw_payload')
        .or(`phone.ilike.%${suffix},raw_payload->>additionalPhone.ilike.%${suffix}`)
        .limit(5);

    console.log("Found:", data?.map(d => d.id), error);
}
main().catch(console.error);
