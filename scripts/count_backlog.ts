
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function countBacklog() {
    const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'soglasovanie-otmeny');

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    console.log(`📊 Total orders in "soglasovanie-otmeny": ${count}`);
}

countBacklog();
