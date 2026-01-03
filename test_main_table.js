const { createClient } = require('@supabase/supabase-js');

// Using the keys we know work
const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'sb_publishable_wP6UgkqRklJNcY3ZG2Tgbg_RDRby_bF';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testMainTable() {
    console.log('Testing write permission on `statuses` table...');

    // 1. Get a valid code
    const { data: list } = await supabase.from('statuses').select('code').limit(1);
    if (!list || list.length === 0) {
        console.error('No statuses found to test.');
        return;
    }
    const code = list[0].code;
    console.log(`Targeting status: ${code}`);

    // 2. Try to update is_working
    const { data, error } = await supabase
        .from('statuses')
        .update({ is_working: true })
        .eq('code', code)
        .select();

    if (error) {
        console.error('FAIL: Could not update `statuses` table.');
        console.error('Error:', error.message);
        console.log('\n--- REQUIRED ACTION ---');
        console.log('We need to enable public updates on this table.');
    } else {
        console.log('SUCCESS: Wrote to `statuses` table!');
        console.log('Data:', data);
    }
}

testMainTable();
