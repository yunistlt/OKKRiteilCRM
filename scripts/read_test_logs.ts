
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkLogs() {
    const { data: logs } = await supabase
        .from('okk_rule_test_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (logs) {
        console.log('Latest Test Logs:');
        logs.forEach(l => {
            console.log(`[${l.created_at}] Rule: ${l.rule_code}, Status: ${l.status}`);
            console.log(`Message: ${l.message}`);
            console.log('Details:', JSON.stringify(l.details, null, 2));
            console.log('---');
        });
    }
}

checkLogs();
