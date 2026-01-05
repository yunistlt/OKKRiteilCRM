
import { supabase } from '@/utils/supabase';

async function checkRecentEvents() {
    console.log('Checking most recent events...');
    const { data: recent, error: err1 } = await supabase
        .from('raw_order_events')
        .select('occurred_at, event_type')
        .order('occurred_at', { ascending: false })
        .limit(5);

    if (err1) {
        console.error('Error:', err1);
        return;
    }

    console.log('Most recent 5 events:', JSON.stringify(recent, null, 2));

    console.log('Checking status changes in last 7 days...');
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count, error: err2 } = await supabase
        .from('raw_order_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'status')
        .gte('occurred_at', sevenDaysAgo.toISOString());

    if (err2) {
        console.error('Error:', err2);
    } else {
        console.log(`Found ${count} recent status change events.`);
    }
}

checkRecentEvents();
