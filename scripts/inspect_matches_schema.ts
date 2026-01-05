
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    const { data, error } = await supabase
        .rpc('get_table_info', { table_name: 'call_order_matches' });

    // If RPC not available, try information schema via SQL query workaround or just guessing?
    // Let's try erroring out on select * limit 1 to see keys in return object if data exists.

    // Better: Select * limit 1
    const { data: rows, error: err } = await supabase
        .from('call_order_matches')
        .select('*')
        .limit(1);

    if (err) console.error(err);
    else if (rows && rows.length > 0) {
        console.log('Columns:', Object.keys(rows[0]));
    } else {
        console.log('Table empty or no access.');
    }
}

checkSchema();
