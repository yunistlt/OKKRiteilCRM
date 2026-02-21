import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Fetching specific call 338944C7965D48789A64C7FBFD3334BA...');
    const { data: calls, error: err2 } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .eq('telphin_call_id', '338944C7965D48789A64C7FBFD3334BA');

    if (calls) console.dir(calls[0], { depth: null });
}
main();
