
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Order 50550 ---');
    const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', 50550)
        .single();

    if (error) {
        console.error('Order Error:', error);
    } else {
        console.log('Order:', order);
    }

    // Phone from screenshot: +7-8313-24-25-34 -> 78313242534 or 8313242534
    // Checking strict and suffix
    const searchPhones = ['78313242534', '8313242534', '242534'];

    console.log('\n--- Searching Calls ---');
    const { data: calls, error: callsError } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .or(`from_number.ilike.%242534%,to_number.ilike.%242534%`) // simple suffix search
        .order('started_at', { ascending: false })
        .limit(5);

    if (callsError) console.error(callsError);
    else {
        calls.forEach(c => {
            console.log(`Call ${c.telphin_call_id}: ${c.started_at}, From: ${c.from_number}, To: ${c.to_number}`);
        });
    }

    console.log('\n--- Checking Existing Matches ---');
    const { data: matches } = await supabase
        .from('call_order_matches')
        .select('*')
        .eq('retailcrm_order_id', 50550);
    console.log('Matches:', matches);

}

check();
