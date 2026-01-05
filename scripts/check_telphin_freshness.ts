
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .from('raw_telphin_calls')
        .select('started_at')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Latest Call Date:', data ? data.started_at : 'No data found');
    }
}

check();
