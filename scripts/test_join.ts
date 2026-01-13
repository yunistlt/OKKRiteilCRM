
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { supabase } from '@/utils/supabase';

async function testJoin() {
    console.log('Testing Joins...');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 35);
    const startStr = startDate.toISOString();

    const { data, error } = await supabase
        .from('call_order_matches')
        .select(`
            telphin_call_id,
            retailcrm_order_id,
            raw_telphin_calls (duration_sec, started_at),
            orders (manager_id)
        `)
        .gte('matched_at', startStr)
        .limit(5);

    if (error) {
        console.log('Join Error:', error);
    } else {
        console.log('Join Success. Rows:', data?.length);
        console.log('Sample:', JSON.stringify(data && data[0], null, 2));
    }
}

testJoin();
