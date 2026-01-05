
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkSchema() {
    console.log('🔍 Checking Schema for raw_order_events...');

    // Attempt to insert a dummy row to fail and see error, OR just check structure via introspection if possible?
    // Supabase JS client doesn't expose listColumns easily without proper permissions on info_schema.
    // Let's try to select one row and see keys.

    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .limit(1);

    if (error) {
        console.error('DB Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('✅ Found keys:', Object.keys(data[0]));
    } else {
        console.log('⚠️ Table empty, cannot infer keys from rows. Trying dummy insert...');
        // Try to insert a row with `field_name` and see if it fails
        const { error: insError } = await supabase.from('raw_order_events').insert({
            retailcrm_order_id: 999999999,
            field_name: 'test',
            occurred_at: new Date().toISOString()
        });

        if (insError) {
            console.error('Insert Test Error:', insError.message);
        } else {
            console.log('✅ Insert worked! Column must exist.');
            // Clean up
            await supabase.from('raw_order_events').delete().eq('retailcrm_order_id', 999999999);
        }
    }
}

checkSchema();
