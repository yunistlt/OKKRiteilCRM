
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function listAllRules() {
    const { data: rules } = await supabase.from('okk_rules').select('code, name, condition_sql, entity_type');
    if (rules) {
        console.log('Total rules:', rules.length);
        rules.forEach(r => {
            console.log(`\nRule: ${r.name} (${r.code})`);
            console.log(`SQL: ${r.condition_sql}`);
        });
    }
}

listAllRules();
