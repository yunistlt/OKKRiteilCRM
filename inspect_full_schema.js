const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'sb_publishable_wP6UgkqRklJNcY3ZG2Tgbg_RDRby_bF';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('=== FULL DATABASE DIAGNOSTIC ===\n');

    // 1. Check STATUSES (Main Table)
    console.log('--- 1. STATUSES TABLE (From RetailCRM) ---');
    const { data: statuses, error: sErr } = await supabase
        .from('statuses')
        .select('*');

    if (sErr) console.error('ERROR:', sErr);
    else {
        console.log(`Total Rows: ${statuses.length}`);
        console.log('Sample Row:', statuses[0]);
        // Check for specific columns
        if (statuses.length > 0) {
            console.log('Columns found:', Object.keys(statuses[0]).join(', '));
        }
    }

    // 2. Check STATUS_SETTINGS (User Settings)
    console.log('\n--- 2. STATUS_SETTINGS TABLE (User Overrides) ---');
    const { data: settings, error: stErr } = await supabase
        .from('status_settings')
        .select('*');

    if (stErr) console.error('ERROR:', stErr);
    else {
        console.log(`Total Rows: ${settings.length}`);
        console.log('All Rows:', JSON.stringify(settings, null, 2));
    }

    // 3. Simulated Write Test (Again)
    console.log('\n--- 3. LIVE WRITE TEST ---');
    const testCode = 'novyi-1'; // A valid status code from screenshots
    console.log(`Attempting to upsert code: "${testCode}"`);

    const { data: writeData, error: writeError } = await supabase
        .from('status_settings')
        .upsert({
            code: testCode,
            is_working: true,
            updated_at: new Date().toISOString()
        })
        .select();

    if (writeError) {
        console.error('WRITE FAILURE:', writeError);
    } else {
        console.log('WRITE SUCCESS:', writeData);
        // Clean up
        await supabase.from('status_settings').delete().eq('code', testCode);
        console.log('(Cleaned up test record)');
    }
}

inspect();
