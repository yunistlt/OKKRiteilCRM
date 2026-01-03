const { createClient } = require('@supabase/supabase-js');

// Hardcoded keys for certainty
const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'sb_publishable_wP6UgkqRklJNcY3ZG2Tgbg_RDRby_bF';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('--- INSPECTING STATUSES (Source) ---');
    const { data: statuses, error: sErr } = await supabase
        .from('statuses')
        .select('*')
        .limit(3);

    if (sErr) console.error('Error reading statuses:', sErr);
    else console.log('Sample statuses:', JSON.stringify(statuses, null, 2));

    console.log('\n--- INSPECTING STATUS_SETTINGS (Target) ---');
    const { data: settings, error: stErr } = await supabase
        .from('status_settings')
        .select('*');

    if (stErr) console.error('Error reading settings:', stErr);
    else {
        console.log('All settings:', JSON.stringify(settings, null, 2));
        console.log(`Total settings rows: ${settings.length}`);
    }

    console.log('\n--- DATA MATCH CHECK ---');
    if (statuses && statuses.length > 0) {
        const sampleCode = statuses[0].code;
        console.log(`Checking match for code: "${sampleCode}"`);

        const { data: match, error: mErr } = await supabase
            .from('status_settings')
            .select('*')
            .eq('code', sampleCode);

        console.log('Direct query result for this code:', match);
    }
}

inspect();
