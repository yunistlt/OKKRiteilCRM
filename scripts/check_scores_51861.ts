import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const orderId = 51861;
    console.log(`Checking order ${orderId}...`);
    
    const { data: score, error } = await supabase
        .from('okk_order_scores')
        .select('calls_status, calls_total_duration, calls_attempts_count, eval_date')
        .eq('order_id', orderId)
        .single();
        
    console.log("Score:", score, error);
}
main();
