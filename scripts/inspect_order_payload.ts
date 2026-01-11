
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });


import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });


import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectValues() {
    const { data, error } = await supabase
        .from('orders')
        .select('raw_payload')
        .not('raw_payload->customFields->data_kontakta', 'is', null)
        .limit(10);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Values for data_kontakta:');
    data?.forEach((row: any) => {
        console.log(row.raw_payload.customFields.data_kontakta);
    });
}

inspectValues();


