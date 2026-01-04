
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function reloadSchema() {
    console.log('Reloading PostgREST schema cache...');

    // We can't issue NOTIFY directly via supabase-js easily without a raw query or stored proc.
    // However, we can use the `rpc` interface if we have a function, or just try to query the table to wake it up?
    // Actually, "Could not find table" means it's missing from the internal cache.

    // The standard way without dashboard is running raw SQL.
    // Supabase JS doesn't support raw SQL strings directly unless we use the 'postgres' library or similar.
    // BUT we can use a workaround: create a function or check if we can query it.

    // Let's try to just select from it to see if it works locally.
    const { data, error } = await supabase.from('statuses').select('*').limit(1);

    if (error) {
        console.error('Local check failed:', error);
    } else {
        console.log('Local check passed. Table exists and is accessible.');
    }
}

reloadSchema();
