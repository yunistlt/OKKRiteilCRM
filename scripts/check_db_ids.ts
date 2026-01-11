
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkIds() {
    console.log('🔍 Checking IDs and Numbers in DB for a few orders...');
    const { data, error } = await supabase
        .from('orders')
        .select('id, number, site')
        .eq('status', 'soglasovanie-otmeny')
        .limit(5);

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    if (data) {
        data.forEach(o => {
            console.log(`Order ID: ${o.id}, Number: ${o.number}, Site: ${o.site}`);
        });
    }
}

checkIds();
