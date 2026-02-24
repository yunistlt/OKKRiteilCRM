import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function main() {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', 51861)
        .single();

    console.log("Order 51861:", data, error);
}
main().catch(console.error);
