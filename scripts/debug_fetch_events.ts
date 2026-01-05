
import { supabase } from '@/utils/supabase';

async function checkEvents() {
    console.log('Fetching recent status change events...');
    const { data: events, error } = await supabase
        .from('raw_order_events')
        .select(`
            event_id,
            event_type,
            raw_payload,
            occurred_at,
            retailcrm_order_id,
            order_metrics!left ( current_status, manager_id, full_order_context )
        `)
        .in('event_type', ['status', 'status_changed'])
        .order('occurred_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${events.length} events.`);
    events.forEach((e: any) => {
        const rawValue = e.raw_payload?.newValue || e.raw_payload?.status;
        const normalizedValue = (typeof rawValue === 'object' && rawValue !== null && 'code' in rawValue)
            ? rawValue.code
            : rawValue;

        console.log('--- Event ---');
        console.log(`ID: ${e.event_id}, Order: ${e.retailcrm_order_id}, Time: ${e.occurred_at}`);
        console.log(`Field: ${e.event_type} (Actual field: ${e.raw_payload?.field}) -> Normalized Value: ${JSON.stringify(normalizedValue)}`);
        console.log('Metrics Data Status:', e.order_metrics ? 'FOUND' : 'MISSING');
        console.log('Order Context Keys:', e.order_metrics?.full_order_context ? Object.keys(e.order_metrics.full_order_context).join(', ') : 'NONE');

        // Check manually
        const comment = e.order_metrics?.full_order_context?.manager_comment;
        console.log(`Manager Comment Value: '${comment}'`);
        console.log(`Is Violation (Empty)? ${!comment || comment.trim() === ''}`);
    });
}

checkEvents();
