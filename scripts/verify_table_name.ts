
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function listTables() {
    console.log('Connecting to:', process.env.NEXT_PUBLIC_SUPABASE_URL);

    // We can't select from information_schema via supabase-js easily.
    // But we can try to selecting from the table we care about.

    console.log('Checking "statuses"...');
    const { data: d1, error: e1 } = await supabase.from('statuses').select('*').limit(1);
    console.log('statuses:', e1 ? e1.message : 'OK, found ' + d1?.length + ' rows');

    console.log('Checking "public.statuses"...');
    const { data: d2, error: e2 } = await supabase.from('public.statuses').select('*').limit(1);
    console.log('public.statuses:', e2 ? e2.message : 'OK, found ' + d2?.length + ' rows');
}

listTables();
