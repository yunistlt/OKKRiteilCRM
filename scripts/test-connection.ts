
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing connection to:', url);
console.log('Using Key (first 10):', key?.substring(0, 10));

const supabase = createClient(url!, key!);

async function test() {
    try {
        const { data, error, status } = await supabase.from('okk_rules').select('*').limit(1);
        console.log('Status Code:', status);
        if (error) {
            console.error('Query Error:', error);
        } else {
            console.log('Success! Data:', data);
        }
    } catch (e) {
        console.error('Test Exception:', e);
    }
}

test();
