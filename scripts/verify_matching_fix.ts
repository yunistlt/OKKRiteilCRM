import { supabase } from '../utils/supabase';
import { matchCallToOrders, saveMatches } from '../lib/call-matching';

async function verify() {
    console.log('--- VERIFICATION: Order #51866 ---');
    const phone = '74959262678';

    // 1. Fetch the order
    const { data: order } = await supabase.from('orders').select('*').eq('number', '51866').single();
    if (!order) {
        console.error('Order #51866 not found');
        return;
    }
    console.log(`Found Order #${order.number} (ID: ${order.id}) with phone: ${order.phone}`);

    // 2. Fetch the calls
    const { data: calls } = await supabase.from('raw_telphin_calls')
        .select('*')
        .or(`from_number.ilike.%${phone}%,to_number.ilike.%${phone}%`)
        .gte('started_at', '2026-02-20T00:00:00')
        .lte('started_at', '2026-02-20T23:59:59');

    console.log(`Found ${calls?.length || 0} calls for phone ${phone}`);

    if (calls) {
        let matchCount = 0;
        for (const call of calls) {
            console.log(`\nProcessing Call ${call.telphin_call_id}...`);
            const matches = await matchCallToOrders(call as any);

            const myOrderMatch = matches.find(m => m.retailcrm_order_id === order.id);
            if (myOrderMatch) {
                console.log(`✅ MATCH FOUND! Confidence: ${myOrderMatch.confidence_score}`);
                console.log(`   Explanation: ${myOrderMatch.explanation}`);
                await saveMatches([myOrderMatch]);
                matchCount++;
            } else {
                console.log(`❌ No match found for this order.`);
                if (matches.length > 0) {
                    console.log(`   But found ${matches.length} other potential matches.`);
                }
            }
        }
        console.log(`\nTotal new matches saved: ${matchCount}`);
    }
}

verify().catch(console.error);
