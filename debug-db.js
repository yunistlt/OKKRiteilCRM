require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(url, key);

async function checkTables() {
    console.log('Checking database tables...');

    // Check if we can select from 'managers'
    const { data: managers, error: mError } = await supabase
        .from('managers')
        .select('*')
        .limit(1);

    if (mError) {
        console.error('❌ Error accessing "managers":', mError.message);
        console.error('Details:', mError);
    } else {
        console.log('✅ Table "managers" exists and is accessible.');
        console.log('Row count (sample):', managers.length);
    }

    // Check matches
    const { data: matches, error: maError } = await supabase
        .from('matches')
        .select('*')
        .limit(1);

    if (maError) {
        console.error('❌ Error accessing "matches":', maError.message);
    } else {
        console.log('✅ Table "matches" exists.');
    }
}

checkTables();
