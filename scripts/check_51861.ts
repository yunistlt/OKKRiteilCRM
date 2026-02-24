import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const orderId = 51861;
    console.log(`Checking order ${orderId}...`);
    
    const { data: matches, error } = await supabase
        .from('call_order_matches')
        .select(`
            telphin_call_id,
            raw_telphin_calls (
                telphin_call_id,
                started_at,
                duration_sec
            )
        `)
        .eq('retailcrm_order_id', orderId);
        
    if (error) {
        console.error("Error fetching matches:", error);
    } else {
        console.log("Matches:", JSON.stringify(matches, null, 2));
    }
}
main();
