
import { supabase } from '../utils/supabase';

async function verifyContext() {
    console.log('Verifying Order Context in RPC...');

    // Test Query: usage of 'om' alias
    // We try to find ANY call where order context exists (amount > -1 is safe check)
    // or just check if the query executes without error.

    // We use a safe date range covers everything
    const start = new Date('2023-01-01').toISOString();
    const end = new Date().toISOString();

    const { data, error } = await supabase.rpc('evaluate_call_rule', {
        condition_sql: 'om.order_amount >= 0 OR om.current_status IS NOT NULL',
        start_time: start,
        end_time: end
    });

    if (error) {
        console.error('❌ Verification FAILED!');
        console.error('RPC Error:', error.message);
        console.error('Details:', error.details);
        console.error('Hint:', error.hint);
        process.exit(1);
    }

    console.log('✅ Verification PASSED!');
    console.log(`Query executed successfully. Found ${data?.length} calls with matching context.`);

    if (data && data.length > 0) {
        console.log('Sample Call:', data[0]);
    } else {
        console.log('No calls matched (expected if no orders linked yet), but SQL Syntax is valid.');
    }
}

verifyContext();
