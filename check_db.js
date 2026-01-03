const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'sb_publishable_wP6UgkqRklJNcY3ZG2Tgbg_RDRby_bF'; // Anon Key

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('Checking database connection...');

    // 1. Check if statuses exist
    const { data: statuses, error: sErr } = await supabase.from('statuses').select('code').limit(1);
    if (sErr) {
        console.error('Error reading statuses:', sErr);
    } else {
        console.log('Statuses found:', statuses);
    }

    // 2. Try to write to status_settings using a known code (first one found)
    if (statuses && statuses.length > 0) {
        const code = statuses[0].code;
        console.log(`Attempting to write setting for code: ${code}`);

        const { data, error } = await supabase
            .from('status_settings')
            .upsert({
                code: code,
                is_working: true,
                updated_at: new Date().toISOString()
            })
            .select();

        if (error) {
            console.error('WRITE ERROR:', error);
        } else {
            console.log('WRITE SUCCESS. Data:', data);
        }
    } else {
        console.log('No statuses to test with.');
    }
}

check();
