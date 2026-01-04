
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkCols() {
    const { data, error } = await supabase
        .from('calls')
        .select('*')
        .limit(1);

    if (data && data.length > 0) {
        console.log('Columns in legacy "calls" table:', Object.keys(data[0]));
        console.log('Sample:', data[0]);
    } else {
        console.log('No calls found or error:', error);
    }
}

checkCols();
