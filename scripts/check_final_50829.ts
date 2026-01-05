
const { createClient } = require('@supabase/supabase-js');

// Hardcoded for debug
const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.from('orders').select('id, number, created_at, status').eq('id', 50829);
    if (error) console.error(error);
    else console.log('Order 50829:', data);
}
check();
