
import { supabase } from '@/utils/supabase';

async function countOrphans() {
    console.log('Counting total events...');
    const { count: total, error: err1 } = await supabase
        .from('raw_order_events')
        .select('*', { count: 'exact', head: true });

    console.log(`Total events in history: ${total}`);

    console.log('Counting orphans (events with no matching order)...');

    // We can't do a "NOT IN" query easily with Supabase JS client efficiently for large datasets without a join filter which is limited.
    // But we can try a filtered select on the foreign table being null?
    // orders!left ( id ) where orders.id is null

    const { count: orphans, error: err2 } = await supabase
        .from('raw_order_events')
        .select('orders!left(order_id)', { count: 'exact', head: true })
        .is('orders.order_id', null);

    if (err2) {
        console.error('Error counting orphans:', err2);
    } else {
        console.log(`❌ Orphan events (to be deleted): ${orphans}`);
        if (total && orphans) {
            console.log(`Percentage to delete: ${((orphans / total) * 100).toFixed(2)}%`);
        }
    }
}

countOrphans();
