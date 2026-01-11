
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function verifySites() {
    const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'soglasovanie-otmeny')
        .is('site', null);

    if (error) {
        console.error('❌ DB Error:', error);
        return;
    }

    console.log(`📊 Orders with NULL site in backlog: ${count}`);
}

verifySites();
