
import { supabase } from '@/utils/supabase';

async function checkEvents() {
    console.log('Fetching recent status change events...');
    const { data: events, error } = await supabase
        .from('raw_order_events')
        .select(`
            event_id,
            field_name,
            new_value,
            occurred_at,
            retailcrm_order_id,
            orders!left ( status, manager_id, full_order_context )
        `)
        .eq('field_name', 'status')
        .order('occurred_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${events.length} events.`);
    events.forEach((e: any) => {
        console.log('--- Event ---');
        console.log(`ID: ${e.event_id}, Time: ${e.occurred_at}`);
        console.log(`Field: ${e.field_name} -> ${e.new_value}`);
        console.log('Order Context:', JSON.stringify(e.orders?.full_order_context, null, 2));

        // Check manually
        const comment = e.orders?.full_order_context?.manager_comment;
        console.log(`Manager Comment Value: '${comment}'`);
        console.log(`Is Violation (Empty)? ${!comment || comment.trim() === ''}`);
    });
}

checkEvents();
