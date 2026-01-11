
import { supabase } from '../utils/supabase';

async function verifyPriorityLogic() {
    console.log('--- Verifying OKK Priority Logic ---');

    const today = new Date().toISOString().split('T')[0];
    const { data: testOrders, error: ordersError } = await supabase
        .from('orders')
        .select('id, number, raw_payload')
        .eq('raw_payload->customFields->>control', 'true')
        .eq('raw_payload->customFields->>data_kontakta', today)
        .limit(5);

    if (ordersError) {
        console.error('Error fetching test orders:', ordersError);
        return;
    }

    if (!testOrders || testOrders.length === 0) {
        console.log('No priority orders found for today in DB.');
    } else {
        console.log('Found ' + testOrders.length + ' priority orders for today.');
        testOrders.forEach(o => console.log('- Order #' + o.number + ' (ID: ' + o.id + ')'));
    }

    const orderId = testOrders && testOrders.length > 0 ? testOrders[0].id : 50824;
    console.log('Checking logic for order ID: ' + orderId);

    const { data: calls } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id, raw_telphin_calls(*)')
        .eq('retailcrm_order_id', orderId);

    console.log('Total calls found: ' + (calls ? calls.length : 0));

    if (calls && calls.length > 0) {
        const dialogs = calls.filter((c: any) =>
            c.raw_telphin_calls &&
            c.raw_telphin_calls.duration_sec > 15 &&
            c.raw_telphin_calls.transcript
        );
        console.log('Successful dialogues found: ' + dialogs.length);
    }

    console.log('Verification script completed.');
}

verifyPriorityLogic();
