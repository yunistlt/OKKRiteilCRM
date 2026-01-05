
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function inspectPayload() {
    console.log('🔍 Inspecting raw_order_events payload...');

    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .limit(3);

    if (error) {
        console.error('DB Error:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('Table is empty.');
        return;
    }

    console.log('Sample Rows:');
    data.forEach((row, i) => {
        console.log(`\n--- Row ${i + 1} ---`);
        console.log(`Event ID: ${row.event_id}`);
        console.log(`Field Name (Current): ${row.field_name}`);
        console.log('Payload Keys:', Object.keys(row.raw_payload));
        console.log('Payload Preview:', JSON.stringify(row.raw_payload, null, 2).substring(0, 300) + '...');

        // Check if potentially useful keys exist
        if (row.raw_payload.field) console.log(`👉 FOUND 'field': ${row.raw_payload.field}`);
        if (row.raw_payload.oldValue) console.log(`👉 FOUND 'oldValue': ${row.raw_payload.oldValue}`);
        if (row.raw_payload.newValue) console.log(`👉 FOUND 'newValue': ${row.raw_payload.newValue}`);
    });
}

inspectPayload();
