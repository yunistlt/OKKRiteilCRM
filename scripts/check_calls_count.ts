
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    const { count, error } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('Error:', error);
    } else {
        console.log(`Total rows in calls table: ${count}`);
    }
}
run();
