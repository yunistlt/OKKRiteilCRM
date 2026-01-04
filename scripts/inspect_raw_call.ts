
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function inspect() {
    const { data, error } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns:', Object.keys(data[0]));
        console.log('Payload:', JSON.stringify(data[0].raw_payload, null, 2));
    } else {
        console.log('No calls found.');
    }
}

inspect();
