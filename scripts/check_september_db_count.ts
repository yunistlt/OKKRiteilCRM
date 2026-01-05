
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- CHECKING SEPTEMBER CALL COUNT IN DB ---');

    // MSK September: Aug 31 21:00 UTC -> Sept 30 21:00 UTC
    const { data, error } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .gte('started_at', '2025-08-31T21:00:00Z')
        .lt('started_at', '2025-09-30T21:00:00Z');

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('--------------------------------');
        console.log(`TOTAL CALLS IN DB (Sep): ${data?.length || 0}`);
        console.log(`TARGET: 4626`);
        console.log('--------------------------------');
    }
}
run();
