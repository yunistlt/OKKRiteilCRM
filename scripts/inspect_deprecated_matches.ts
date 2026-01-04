
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkSchema() {
    const { data, error } = await supabase
        .from('matches_deprecated')
        .select('*')
        .limit(1);

    if (data && data.length > 0) {
        console.log('Columns in matches_deprecated:', Object.keys(data[0]));
        console.log('Sample:', data[0]);
    } else {
        console.log('No data or error:', error);
    }
}

checkSchema();
