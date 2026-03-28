import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function runRecalculation() {
    console.log('Starting stats recalculation...');
    const { data, error } = await supabase.rpc('recalculate_all_client_stats');
    
    if (error) {
        if (error.message.includes('not found')) {
            console.error('SQL Function not found! Please run the migration first.');
            console.log('You can run the SQL script in migrations/20260328_recalculate_client_stats.sql in the Supabase Dashboard.');
        } else {
            console.error('RPC Error:', error);
        }
        process.exit(1);
    }
    
    console.log('Success! Statistics recalculated for all clients.');
}

runRecalculation();
