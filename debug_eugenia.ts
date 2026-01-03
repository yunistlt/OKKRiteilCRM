
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const { supabase } = require('./utils/supabase');

async function run() {
    console.log('--- Checking Eugenia (ID 98) specific status ---');
    console.log('Checking with Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Service Role Found' : 'Not Found');

    const { data: calls, error } = await supabase
        .from('calls')
        .select(`
            id, 
            transcript, 
            record_url, 
            is_answering_machine, 
            am_detection_result, 
            timestamp,
            matches!inner (
                orders!inner (
                    manager_id
                )
            )
        `)
        .eq('matches.orders.manager_id', '98')
        .order('timestamp', { ascending: false });

    if (error) {
        console.error('Query error:', error);
        return;
    }

    if (!calls || calls.length === 0) {
        console.log('No calls found for manager 98');
        return;
    }

    const unprocessed = calls.filter((c: any) => !c.transcript && c.record_url);
    const success = calls.filter((c: any) => c.transcript);
    const errorsList = calls.filter((c: any) => c.am_detection_result && (c.am_detection_result.error || (c.am_detection_result.reason && c.am_detection_result.reason.toLowerCase().includes('error'))));

    console.log('Total calls found for 98:', calls.length);
    console.log('Processed successfully (Live or AM):', success.length);
    console.log('Waiting for processing (transcript is null):', unprocessed.length);
    console.log('Detection errors found:', errorsList.length);

    if (errorsList.length > 0) {
        console.log('Sample Error Info:', JSON.stringify(errorsList[0].am_detection_result, null, 2));
    }

    if (unprocessed.length > 0) {
        console.log('Sample Unprocessed ID:', unprocessed[0].id);
        console.log('Record URL exists:', !!unprocessed[0].record_url);
    }
}
run();
