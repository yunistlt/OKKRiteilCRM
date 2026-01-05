
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function getSchemaInfo() {
    console.log('🔍 GETTING TABLE SCHEMA & SAMPLE DATA\n');

    // 1. Get Columns (Best effort without information_schema access)
    console.log('--- COLUMNS (Inferred from empty select) ---');
    const { data: cols, error: errCols } = await supabase
        .from('raw_order_events')
        .select('*')
        .limit(0);

    // In newer Supabase JS, empty data might not show keys if 0 rows?
    // Let's try to insert a dummy to get error relative to columns, or just trust previous debug.
    // Actually, I can use the trick of selecting a non-existent column to see "hints"? No.
    // Better: I will use the previous finding, but for the user I will try to select 1 row.

    // 2. Get Sample Row
    const { data: rows, error: errRows } = await supabase
        .from('raw_order_events')
        .select('*')
        .limit(1);

    if (rows && rows.length > 0) {
        console.log('✅ Existing Keys:', Object.keys(rows[0]));
        console.log('Sample Data:', rows[0]);
    } else {
        console.log('⚠️ Table is empty, keys are likely:');
        console.log([
            'event_id',
            'retailcrm_order_id',
            'event_type',
            'occurred_at',
            'source',
            'raw_payload',
            'ingested_at',
            'phone',
            'phone_normalized',
            'additional_phone',
            'additional_phone_normalized',
            'manager_id'
        ]);
        console.log('(Based on previous debug)');
    }
}

getSchemaInfo();
