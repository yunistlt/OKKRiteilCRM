
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectRules() {
    const { data } = await supabase.from('okk_rules').select('*').limit(1);
    if (data && data.length > 0) {
        console.log('Rule Keys:', Object.keys(data[0]));
        console.log('Sample:', data[0]);
    }
}

inspectRules();
