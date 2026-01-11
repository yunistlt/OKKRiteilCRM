
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function listTables() {
    const { data: tables, error } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');

    if (error) {
        // Fallback: try querying a common table to see if it works, 
        // usually information_schema might be restricted via PostgREST.
        // Let's use a raw query if possible, or just list what we know.
        console.error('❌ Error listing tables via information_schema:', error);

        // Let's try to query some likely names blindly
        const likelyTables = ['messages', 'emails', 'comments', 'communications', 'raw_order_events', 'orders', 'call_order_matches', 'raw_telphin_calls'];
        for (const t of likelyTables) {
            const { error: tErr } = await supabase.from(t).select('count').limit(1);
            if (!tErr) console.log(`✅ Table exists: ${t}`);
            else console.log(`❌ Table missing or error for: ${t} (${tErr.message})`);
        }
    } else {
        console.log('✅ Tables found:');
        tables.forEach(t => console.log(`- ${t.table_name}`));
    }
}

listTables();
