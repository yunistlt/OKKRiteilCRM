import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function main() {
    const { data: calls } = await supabase
        .from('raw_telphin_calls')
        .select('started_at, from_number, to_number, duration_sec')
        .or('to_number.ilike.%9053167593,from_number.ilike.%9053167593')
        .order('started_at', { ascending: false })
        .limit(2);
        
    console.log("Raw calls in DB:", calls);
}
main().catch(console.error);
