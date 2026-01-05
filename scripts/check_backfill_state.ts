
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { supabase } from '../utils/supabase';

async function main() {
    console.log('--- CHECK BACKFILL STATE ---');
    const { data, error } = await supabase
        .from('sync_state')
        .select('*')
        .like('key', 'telphin_backfill%');

    if (error) {
        console.error('Error:', error);
        return;
    }

    data.forEach(row => {
        console.log(`${row.key}: ${row.value} (Updated: ${row.updated_at})`);
    });
}

main();
