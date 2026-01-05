
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function resetCursor() {
    console.log('=== RESETTING BACKFILL CURSOR ===');

    const key = 'telphin_backfill_cursor';
    const value = '2025-09-01T00:00:00Z'; // Start date

    const { error } = await supabase
        .from('sync_state')
        .upsert({
            key,
            value,
            updated_at: new Date().toISOString()
        });

    if (error) {
        console.error("Error resetting cursor:", error);
    } else {
        console.log(`✅ Cursor '${key}' reset to: ${value}`);
    }
}

resetCursor().catch(console.error);
