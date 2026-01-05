
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function findOrder() {
    const TARGET = '50829';
    console.log(`🔍 Searching for Order ${TARGET}...`);

    // Check by 'number' (if column exists) or 'id' (retailcrm id often used as id)
    // We'll try a few columns to be safe.

    // 1. Try exact ID match
    const { data: byId, error: e1 } = await supabase
        .from('orders')
        .select('*')
        .eq('id', TARGET)
        .maybeSingle();

    if (byId) {
        console.log('✅ Found by ID!');
        console.log(byId);
        return;
    }

    // 2. Try 'number' column if it exists (often textual)
    // We select * so if it errors (column not found), we'll know.
    const { data: byNumber, error: e2 } = await supabase
        .from('orders')
        .select('*')
        .eq('number', TARGET) // Assuming column name is 'number'
        .maybeSingle();

    if (byNumber) {
        console.log('✅ Found by Number!');
        console.log(byNumber);
        return;
    }

    // 3. Try searching raw_order_events just in case it's there but not processed to orders table yet
    const { data: rawEvent } = await supabase
        .from('raw_order_events')
        .select('*')
        .eq('retailcrm_order_id', TARGET)
        .limit(1);

    if (rawEvent && rawEvent.length > 0) {
        console.log('⚠️ Found in Raw Events (History) but NOT in Orders table?');
        console.log('This implies "Sync History" got it, but "Sync Orders" or "Propagate" missed it.');
        console.log(rawEvent[0]);
        return;
    }

    console.log('❌ Order NOT found in DB (neither Orders table nor Raw Events).');
}

findOrder();
