
import { supabase } from './utils/supabase';

async function run() {
    const managerId = 249; // Manager we know has matches
    const startStr = '2025-12-01T00:00:00Z';

    console.log('--- Testing API Query Logic ---');
    const { data, error } = await supabase
        .from('calls')
        .select(`
            id,
            timestamp,
            matches!inner (
                order_id,
                orders!inner (
                    manager_id
                )
            )
        `)
        .eq('matches.orders.manager_id', managerId)
        .gte('timestamp', startStr)
        .limit(5);

    if (error) {
        console.error('Query Error:', error);
    } else {
        console.log('Query Results (count):', data?.length);
        console.log('Sample Data:', JSON.stringify(data, null, 2));
    }
}
run();
