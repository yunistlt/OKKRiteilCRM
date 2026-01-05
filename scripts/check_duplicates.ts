
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- CHECKING FOR DUPLICATE CALLS ---');

    // Look for calls that share the same suffix in telphin_call_id
    // Old format: XXXXXX-UUID
    // New format: UUID

    const { data, error } = await supabase.rpc('get_duplicate_telphin_calls_check');

    if (error) {
        // Fallback: just fetch some samples from September
        console.log('Falling back to manual check...');
        const { data: samples } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, started_at')
            .gte('started_at', '2025-08-31T21:00:00Z')
            .lt('started_at', '2025-09-01T21:00:00Z')
            .limit(10);

        console.table(samples);
    } else {
        console.log('Duplicate report:', data);
    }
}
run();
