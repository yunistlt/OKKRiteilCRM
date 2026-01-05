
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkLag() {
    console.log('🔍 Checking Last Synced Event Time...');

    const { data, error } = await supabase
        .from('raw_order_events')
        .select('occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('DB Error:', error);
        return;
    }

    if (!data) {
        console.log('⚠️ No events in DB at all!');
        return;
    }

    console.log(`⏱️ Latest Event Time in DB: ${data.occurred_at}`);

    const lagMs = Date.now() - new Date(data.occurred_at).getTime();
    const lagHours = lagMs / (1000 * 60 * 60);

    console.log(`📉 Lag: ${lagHours.toFixed(1)} hours`);
}

checkLag();
