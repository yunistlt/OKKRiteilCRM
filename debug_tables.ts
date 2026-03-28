
import { supabase } from './utils/supabase';

async function listTables() {
    const { data, error } = await supabase.rpc('get_tables_info'); // if exists
    // actually, let's just try to query information_schema if permitted
    // or just try common names
    
    const tables = ['clients', 'ai_outreach_logs', 'ai_reactivation_campaigns', 'orders', 'managers'];
    for (const t of tables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        console.log(`Table ${t}: ${error ? 'Error/Missing' : count + ' records'}`);
    }
}

listTables();
