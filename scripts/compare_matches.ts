
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function compareTables() {
    console.log('--- COMPARING MATCH TABLES ---');

    // 1. Check NEW table
    const { count: newCount, error: err1 } = await supabase
        .from('call_order_matches')
        .select('*', { count: 'exact', head: true });

    if (err1) console.error('Error checking call_order_matches:', err1.message);
    else console.log(`✅ call_order_matches (ACTIVE): ${newCount} rows`);

    // 2. Check DEPRECATED table
    // It might not exist in types, so we use string literal if possible or just try catch
    const { count: oldCount, error: err2 } = await supabase
        .from('matches_deprecated')
        .select('*', { count: 'exact', head: true });

    if (err2) {
        console.log(`ℹ️ matches_deprecated: Not accessible or doesn't exist (${err2.message})`);
    } else {
        console.log(`⚠️ matches_deprecated (OLD): ${oldCount} rows`);
    }
}

compareTables();
