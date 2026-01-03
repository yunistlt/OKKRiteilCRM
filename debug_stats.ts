
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from './utils/supabase';

async function run() {
    console.log('Using Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Service Role Found' : 'Not Found');
    const { data, error } = await supabase.from('dialogue_stats').select('*');
    if (error) {
        console.error('Fetch Error:', error);
    } else {
        console.log('Dialogue Stats count:', data?.length);
        console.log('Sample Data:', data?.[0]);
    }
}
run();
