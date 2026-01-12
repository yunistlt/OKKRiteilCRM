
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lywtzgntmibdpgoijbty.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
    console.log('Checking statuses of calls with recording URLs...');
    const { data: calls, error } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, recording_url, started_at, matches:call_order_matches!inner(orders!inner(status))')
        .not('recording_url', 'is', null)
        .gte('started_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(20);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Results:', JSON.stringify(calls, null, 2));
        const statuses = calls?.map(c => c.matches?.orders?.status);
        console.log('Unique statuses found:', [...new Set(statuses)]);
    }
}

check();
